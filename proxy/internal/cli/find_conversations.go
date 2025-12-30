package cli

import (
	"database/sql"
	"flag"
	"fmt"
	"os"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

type FindConversationsOptions struct {
	DBPath    string
	RequestID string
}

func RunFindConversations(args []string) error {
	fs := flag.NewFlagSet("find-conversations", flag.ExitOnError)
	opts := &FindConversationsOptions{}

	fs.StringVar(&opts.DBPath, "db", "requests.db", "Path to SQLite database")
	fs.StringVar(&opts.RequestID, "id", "", "Request ID to start from (default: most recent)")

	fs.Usage = func() {
		fmt.Println(`Usage: proxy find-conversations [options]

Find related requests by matching context prefix.

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

	requestID := opts.RequestID
	if requestID == "" {
		err := db.QueryRow("SELECT id FROM requests_context ORDER BY timestamp DESC LIMIT 1").Scan(&requestID)
		if err != nil {
			return fmt.Errorf("failed to get most recent request: %w", err)
		}
	}

	// Get the context for this request
	var context string
	var inputTimestamp string
	err = db.QueryRow("SELECT context, timestamp FROM requests_context WHERE id = ?", requestID).Scan(&context, &inputTimestamp)
	if err != nil {
		return fmt.Errorf("failed to get context for request %s: %w", requestID, err)
	}

	// Compute prefix by popping messages from context
	prefix := computeContextPrefix(context)

	fmt.Printf("%s %s:\n", inputTimestamp, requestID)
	fmt.Printf("  %-26s %-18s %-40s %6s %-12s %-10s %12s %12s\n",
		"Timestamp", "Id", "Context", "Size", "LastId", "Streaming", "InOutTokens", "CacheReads")

	results, err := FindConversationsByPrefix(db, prefix)
	if err != nil {
		return err
	}

	for _, r := range results {
		streamStr := ""
		if r.Streaming != nil {
			if *r.Streaming == 1 {
				streamStr = "yes"
			} else {
				streamStr = "no"
			}
		}

		// Truncate from start if needed
		contextDisplay := r.Context
		if len(contextDisplay) > 40 {
			contextDisplay = "..." + contextDisplay[len(contextDisplay)-37:]
		}

		// Size = number of commas + 1 (or 0 if empty)
		size := 0
		if r.Context != "" {
			size = strings.Count(r.Context, ",") + 1
		}

		fmt.Printf("  %-26s %-18s %-40s %6d %-12d %-10s %12d %12d\n",
			r.Timestamp, r.ID, contextDisplay, size, r.LastMessageID, streamStr, r.TotalTokens, r.CacheReads)
	}

	fmt.Printf("\nFound %d requests matching prefix\n", len(results))

	return nil
}

// computeContextPrefix pops elements from context to create a search prefix
// Pop 2 if len >= 4, otherwise 1 if len >= 2, otherwise 0
func computeContextPrefix(context string) string {
	if context == "" {
		return ""
	}

	parts := strings.Split(context, ",")
	popCount := 0
	if len(parts) >= 4 {
		popCount = 2
	} else if len(parts) >= 2 {
		popCount = 1
	}

	if popCount > 0 && len(parts) > popCount {
		parts = parts[:len(parts)-popCount]
	}

	return strings.Join(parts, ",")
}

type ConversationResult struct {
	ID            string
	Timestamp     string
	Context       string
	LastMessageID int64
	Streaming     *int
	TotalTokens   int64
	CacheReads    int64
}

func FindConversationsByPrefix(db *sql.DB, prefix string) ([]ConversationResult, error) {
	query := `
	SELECT
		rc.id,
		rc.timestamp,
		rc.context,
		rc.last_message_id,
		rc.streaming,
		COALESCE(u.input_tokens, 0) + COALESCE(u.output_tokens, 0) + COALESCE(u.cache_creation_input_tokens, 0) as total_tokens,
		COALESCE(u.cache_read_input_tokens, 0) as cache_reads
	FROM requests_context rc
	LEFT JOIN usage u ON rc.id = u.id
	WHERE rc.context LIKE ? OR rc.context = ?
	ORDER BY rc.timestamp ASC
	`

	pattern := prefix + ",%"
	rows, err := db.Query(query, pattern, prefix)
	if err != nil {
		return nil, fmt.Errorf("failed to query conversations: %w", err)
	}
	defer rows.Close()

	var results []ConversationResult
	for rows.Next() {
		var r ConversationResult
		if err := rows.Scan(&r.ID, &r.Timestamp, &r.Context, &r.LastMessageID, &r.Streaming, &r.TotalTokens, &r.CacheReads); err != nil {
			return nil, err
		}
		results = append(results, r)
	}

	return results, rows.Err()
}
