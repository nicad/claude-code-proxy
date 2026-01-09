package cli

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"os"

	_ "github.com/mattn/go-sqlite3"

	"github.com/seifghazi/claude-code-monitor/internal/service"
)

type IndexMessagesOptions struct {
	DBPath          string
	Debug           bool
	ContinueOnError bool
	Recreate        bool
}

func RunIndexMessages(args []string) error {
	fs := flag.NewFlagSet("index-messages", flag.ExitOnError)
	opts := &IndexMessagesOptions{}

	fs.StringVar(&opts.DBPath, "db", "requests.db", "Path to SQLite database")
	fs.BoolVar(&opts.Debug, "debug", false, "Print debug info on errors")
	fs.BoolVar(&opts.ContinueOnError, "continue-on-error", false, "Continue processing after errors")
	fs.BoolVar(&opts.Recreate, "recreate", false, "Drop and recreate tables before indexing")

	fs.Usage = func() {
		fmt.Println(`Usage: proxy index-messages [options]

Index requests into the messages table by extracting message content from request bodies.
By default, only indexes new requests since last run. Use --recreate to rebuild from scratch.

Options:`)
		fs.PrintDefaults()
	}

	if err := fs.Parse(args); err != nil {
		return err
	}

	if _, err := os.Stat(opts.DBPath); os.IsNotExist(err) {
		return fmt.Errorf("database file '%s' not found", opts.DBPath)
	}

	dbPath := opts.DBPath + "?_journal_mode=WAL&_busy_timeout=5000&_synchronous=NORMAL"
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}
	defer db.Close()

	// Create the shared indexer
	indexer := service.NewIndexer(db)

	// Check if tables exist and determine if we need full recreate
	tablesExist := checkTablesExist(db)
	forceRecreate := opts.Recreate || !tablesExist

	if err := indexer.CreateTables(forceRecreate); err != nil {
		return fmt.Errorf("failed to create messages table: %w", err)
	}

	var requests []requestRef
	if forceRecreate {
		fmt.Println("Indexing all requests...")
		requests, err = fetchAllRequestIDs(db)
	} else {
		fmt.Println("Indexing new requests since last run...")
		requests, err = fetchNewRequestIDs(db)
	}
	if err != nil {
		return fmt.Errorf("failed to fetch request IDs: %w", err)
	}

	if len(requests) == 0 {
		fmt.Println("No new requests to index.")
		return nil
	}

	fmt.Printf("Found %d requests to index\n", len(requests))

	successCount := 0
	errorCount := 0

	for _, req := range requests {
		// Fetch body and response for this request
		body, response, err := fetchRequestData(db, req.ID)
		if err != nil {
			errorCount++
			fmt.Fprintf(os.Stderr, "ERROR fetching id=%s ts=%s\n", req.ID, req.Timestamp)
			fmt.Fprintf(os.Stderr, "  %v\n", err)
			if !opts.ContinueOnError {
				fmt.Fprintf(os.Stderr, "\nProcessed: %d successful, %d errors\n", successCount, errorCount)
				fmt.Fprintf(os.Stderr, "\nStopping at first error. Use --continue-on-error to process all rows.\n")
				return err
			}
			continue
		}

		// Use the shared indexer
		err = indexer.IndexRequest(req.ID, req.Timestamp, body, response)
		if err != nil {
			errorCount++
			fmt.Fprintf(os.Stderr, "ERROR processing id=%s ts=%s\n", req.ID, req.Timestamp)
			fmt.Fprintf(os.Stderr, "  %v\n", err)

			if opts.Debug {
				printRequestBody(db, req.ID)
			}

			if !opts.ContinueOnError {
				fmt.Fprintf(os.Stderr, "\nProcessed: %d successful, %d errors\n", successCount, errorCount)
				fmt.Fprintf(os.Stderr, "\nStopping at first error. Use --continue-on-error to process all rows.\n")
				return err
			}
		} else {
			successCount++
		}
	}

	fmt.Printf("\nProcessed: %d successful, %d errors\n", successCount, errorCount)

	var totalMessages int
	err = db.QueryRow("SELECT COUNT(*) FROM messages").Scan(&totalMessages)
	if err == nil {
		fmt.Printf("Total: %d message rows indexed\n", totalMessages)
	}

	var uniqueContent int
	err = db.QueryRow("SELECT COUNT(*) FROM message_content").Scan(&uniqueContent)
	if err == nil {
		fmt.Printf("Unique message content: %d\n", uniqueContent)
	}

	return nil
}

type requestRef struct {
	ID        string
	Timestamp string
}

func fetchAllRequestIDs(db *sql.DB) ([]requestRef, error) {
	rows, err := db.Query("SELECT id, timestamp FROM requests ORDER BY timestamp")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var requests []requestRef
	for rows.Next() {
		var r requestRef
		if err := rows.Scan(&r.ID, &r.Timestamp); err != nil {
			return nil, err
		}
		requests = append(requests, r)
	}
	return requests, rows.Err()
}

// checkTablesExist returns true if the requests_context table exists
func checkTablesExist(db *sql.DB) bool {
	var name string
	err := db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='requests_context'").Scan(&name)
	return err == nil
}

// fetchNewRequestIDs fetches requests that haven't been indexed yet.
// To handle inflight requests from previous runs, it looks back 10 minutes from the most recent indexed request.
func fetchNewRequestIDs(db *sql.DB) ([]requestRef, error) {
	// Get the most recent timestamp from requests_context
	var maxTimestamp string
	err := db.QueryRow("SELECT MAX(timestamp) FROM requests_context").Scan(&maxTimestamp)
	if err != nil || maxTimestamp == "" {
		// No indexed requests yet, fetch all
		return fetchAllRequestIDs(db)
	}

	// Fetch requests that are:
	// 1. At least 10 minutes before the max timestamp (to catch inflight)
	// 2. Not already in requests_context
	query := `
		SELECT r.id, r.timestamp
		FROM requests r
		WHERE datetime(r.timestamp) >= datetime(?, '-10 minutes')
		  AND r.id NOT IN (SELECT id FROM requests_context)
		ORDER BY r.timestamp
	`
	rows, err := db.Query(query, maxTimestamp)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var requests []requestRef
	for rows.Next() {
		var r requestRef
		if err := rows.Scan(&r.ID, &r.Timestamp); err != nil {
			return nil, err
		}
		requests = append(requests, r)
	}
	return requests, rows.Err()
}

// fetchRequestData fetches body and response JSON for a request
func fetchRequestData(db *sql.DB, requestID string) (body json.RawMessage, response json.RawMessage, err error) {
	var bodyStr string
	var responseStr sql.NullString
	err = db.QueryRow("SELECT body, response FROM requests WHERE id = ?", requestID).Scan(&bodyStr, &responseStr)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to fetch request: %w", err)
	}

	body = json.RawMessage(bodyStr)
	if responseStr.Valid {
		response = json.RawMessage(responseStr.String)
	}
	return body, response, nil
}

func printRequestBody(db *sql.DB, id string) {
	var body string
	err := db.QueryRow("SELECT body FROM requests WHERE id = ?", id).Scan(&body)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  Could not fetch body: %v\n", err)
		return
	}

	var parsed interface{}
	if err := json.Unmarshal([]byte(body), &parsed); err != nil {
		fmt.Fprintf(os.Stderr, "  Body (raw, first 500 chars): %s\n", truncate(body, 500))
	} else {
		formatted, _ := json.MarshalIndent(parsed, "  ", "  ")
		fmt.Fprintf(os.Stderr, "  Body:\n  %s\n", truncate(string(formatted), 2000))
	}
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
