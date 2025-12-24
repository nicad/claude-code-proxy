package cli

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"os"

	_ "github.com/mattn/go-sqlite3"
)

type ReindexMessagesOptions struct {
	DBPath          string
	Debug           bool
	ContinueOnError bool
}

func RunReindexMessages(args []string) error {
	fs := flag.NewFlagSet("reindex-messages", flag.ExitOnError)
	opts := &ReindexMessagesOptions{}

	fs.StringVar(&opts.DBPath, "db", "requests.db", "Path to SQLite database")
	fs.BoolVar(&opts.Debug, "debug", false, "Print debug info on errors")
	fs.BoolVar(&opts.ContinueOnError, "continue-on-error", false, "Continue processing after errors")

	fs.Usage = func() {
		fmt.Println(`Usage: proxy reindex-messages [options]

Reindex requests into the messages table by extracting message content from request bodies.

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

	if err := CreateMessagesTable(db, true); err != nil {
		return fmt.Errorf("failed to create messages table: %w", err)
	}

	requests, err := fetchAllRequestIDs(db)
	if err != nil {
		return fmt.Errorf("failed to fetch request IDs: %w", err)
	}

	successCount := 0
	errorCount := 0

	for _, req := range requests {
		err := InsertMessageRows(db, req.ID)
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
		fmt.Printf("Total: %d content items indexed\n", totalMessages)
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

// CreateMessagesTable creates the messages table.
// If forceRecreate is true, drops and recreates the table.
// If false, only creates if it doesn't exist.
func CreateMessagesTable(db *sql.DB, forceRecreate bool) error {
	if forceRecreate {
		if _, err := db.Exec("DROP TABLE IF EXISTS messages"); err != nil {
			return err
		}
	}

	schema := `
	CREATE TABLE IF NOT EXISTS messages (
		id VARCHAR NOT NULL,
		ts TIMESTAMP NOT NULL,
		message_position INTEGER NOT NULL,
		message_role VARCHAR NOT NULL,
		content_position INTEGER NOT NULL,
		content_type VARCHAR NOT NULL,
		content_json VARCHAR NOT NULL,
		PRIMARY KEY(id, message_position, content_position)
	);
	CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts);
	CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(message_role);
	CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(content_type);
	`

	_, err := db.Exec(schema)
	return err
}

// InsertMessageRows extracts messages from a request's body and inserts them into the messages table.
// Handles both array content (multiple content blocks) and string content (simple text).
func InsertMessageRows(db *sql.DB, requestID string) error {
	var body, timestamp string
	err := db.QueryRow("SELECT body, timestamp FROM requests WHERE id = ?", requestID).Scan(&body, &timestamp)
	if err != nil {
		return fmt.Errorf("failed to fetch request: %w", err)
	}

	var request struct {
		Messages []struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		} `json:"messages"`
	}

	if err := json.Unmarshal([]byte(body), &request); err != nil {
		return fmt.Errorf("failed to parse request body: %w", err)
	}

	if len(request.Messages) == 0 {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO messages (id, ts, message_position, message_role, content_position, content_type, content_json)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for msgPos, msg := range request.Messages {
		if len(msg.Content) == 0 {
			continue
		}

		// Try to parse content as array first
		var contentArray []json.RawMessage
		if err := json.Unmarshal(msg.Content, &contentArray); err == nil {
			// Content is an array of content blocks
			for contentPos, contentItem := range contentArray {
				var block struct {
					Type string `json:"type"`
				}
				json.Unmarshal(contentItem, &block)

				_, err := stmt.Exec(requestID, timestamp, msgPos, msg.Role, contentPos, block.Type, string(contentItem))
				if err != nil {
					return fmt.Errorf("failed to insert message: %w", err)
				}
			}
		} else {
			// Content is a plain string
			var contentStr string
			if err := json.Unmarshal(msg.Content, &contentStr); err != nil {
				return fmt.Errorf("failed to parse content as string: %w", err)
			}

			// Create a synthetic content block
			contentJSON, _ := json.Marshal(map[string]string{
				"type": "text",
				"text": contentStr,
			})

			_, err := stmt.Exec(requestID, timestamp, msgPos, msg.Role, 0, "text", string(contentJSON))
			if err != nil {
				return fmt.Errorf("failed to insert message: %w", err)
			}
		}
	}

	return tx.Commit()
}
