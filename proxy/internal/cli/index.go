package cli

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"

	_ "github.com/mattn/go-sqlite3"
	"github.com/tiktoken-go/tokenizer"
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

	// Check if tables exist and determine if we need full recreate
	tablesExist := checkTablesExist(db)
	forceRecreate := opts.Recreate || !tablesExist

	if err := CreateMessagesTable(db, forceRecreate); err != nil {
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

// CreateMessagesTable creates the message_content, messages, and requests_context tables.
// If forceRecreate is true, drops and recreates the tables.
func CreateMessagesTable(db *sql.DB, forceRecreate bool) error {
	if forceRecreate {
		if _, err := db.Exec("DROP VIEW IF EXISTS requests_context_summary"); err != nil {
			return err
		}
		if _, err := db.Exec("DROP TABLE IF EXISTS messages"); err != nil {
			return err
		}
		if _, err := db.Exec("DROP TABLE IF EXISTS message_content"); err != nil {
			return err
		}
		if _, err := db.Exec("DROP TABLE IF EXISTS requests_context"); err != nil {
			return err
		}
	}

	schema := `
	CREATE TABLE IF NOT EXISTS message_content (
		id             INTEGER PRIMARY KEY,
		message_hash   TEXT NOT NULL UNIQUE,
		role           TEXT NOT NULL,
		signature      TEXT NOT NULL,
		content        TEXT NOT NULL,
		token_estimate INTEGER NOT NULL DEFAULT 0,
		created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		created_by     TEXT NOT NULL
	);
	-- CREATE INDEX IF NOT EXISTS idx_message_content_hash ON message_content(message_hash);

	CREATE TABLE IF NOT EXISTS messages (
		id               VARCHAR NOT NULL,
		message_position INTEGER NOT NULL,
		timestamp        TIMESTAMP NOT NULL,
		message_hash     TEXT NOT NULL,
		message_id       INTEGER NOT NULL,
		kind             INTEGER NOT NULL,
		PRIMARY KEY(id, message_position)
	);
	CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(timestamp);
	CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);

	-- TODO: move some of it into the requests table ?
	CREATE TABLE IF NOT EXISTS requests_context (
		id                  VARCHAR NOT NULL PRIMARY KEY,
		timestamp           TIMESTAMP NOT NULL,
		last_message_id     INTEGER NOT NULL,
		context             TEXT NOT NULL,
		new_context         TEXT NOT NULL,
		context_msg_count   INTEGER NOT NULL,
		status_code         INTEGER,
		streaming           INTEGER,
		stop_reason         TEXT,
		response_id         TEXT,
		response_role       TEXT,
		response_signature  TEXT,
		response_message_id INTEGER,
		system_tokens       INTEGER NOT NULL DEFAULT 0,
		tools_tokens        INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX IF NOT EXISTS idx_requests_context_ts ON requests_context(timestamp);
	CREATE INDEX IF NOT EXISTS idx_requests_context_last_msg ON requests_context(last_message_id);
	CREATE INDEX IF NOT EXISTS idx_requests_context_context ON requests_context(context);
	CREATE INDEX IF NOT EXISTS idx_requests_context_new_context ON requests_context(new_context);

	-- View with formatted context_display (first 2, [N], last 4)
	DROP VIEW IF EXISTS requests_context_summary;
	CREATE VIEW requests_context_summary AS
	WITH parsed AS (
		SELECT
			*,
			CASE WHEN context = '' OR context IS NULL THEN '[]'
				 ELSE '["' || replace(context, ',', '","') || '"]'
			END as json_ctx,
			CASE WHEN context = '' OR context IS NULL THEN 0
				 ELSE length(context) - length(replace(context, ',', '')) + 1
			END as elem_count
		FROM requests_context
	)
	SELECT
		id,
		timestamp,
		last_message_id,
		context,
		CASE
			WHEN elem_count = 0 THEN ''
			WHEN elem_count <= 6 THEN context
			ELSE
				json_extract(json_ctx, '$[0]') || ',' ||
				json_extract(json_ctx, '$[1]') || ',..[' ||
				(elem_count - 6) || ']..,' ||
				json_extract(json_ctx, '$[' || (elem_count - 4) || ']') || ',' ||
				json_extract(json_ctx, '$[' || (elem_count - 3) || ']') || ',' ||
				json_extract(json_ctx, '$[' || (elem_count - 2) || ']') || ',' ||
				json_extract(json_ctx, '$[' || (elem_count - 1) || ']')
		END as context_display,
		elem_count as context_size,
		new_context,
		context_msg_count,
		status_code,
		streaming,
		stop_reason,
		response_id,
		response_role,
		response_signature,
		response_message_id,
		system_tokens,
		tools_tokens
	FROM parsed;
	`

	_, err := db.Exec(schema)
	return err
}

// sha256Hash computes SHA256 hash of data and returns hex string
func sha256Hash(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// normalizeMessage normalizes message content for consistent hashing:
// 1. Converts string content to array format: "content":"text" -> "content":[{"type":"text","text":"text"}]
// 2. Removes cache_control fields from content blocks
func normalizeMessage(msgRaw json.RawMessage) json.RawMessage {
	var msg map[string]interface{}
	if err := json.Unmarshal(msgRaw, &msg); err != nil {
		return msgRaw // fallback to original
	}

	// Normalize content format and remove cache_control
	switch content := msg["content"].(type) {
	case string:
		// Convert string content to array format
		msg["content"] = []interface{}{
			map[string]interface{}{"type": "text", "text": content},
		}
	case []interface{}:
		// Remove cache_control from each block
		for _, block := range content {
			if blockMap, ok := block.(map[string]interface{}); ok {
				delete(blockMap, "cache_control")
			}
		}
	}

	normalized, err := json.Marshal(msg)
	if err != nil {
		return msgRaw
	}
	return normalized
}

// InsertMessageRows extracts messages from a request's body and inserts them into the messages table.
// Handles both array content (multiple content blocks) and string content (simple text).
func InsertMessageRows(db *sql.DB, requestID string) error {
	var body, timestamp string
	var responseJSON sql.NullString
	err := db.QueryRow("SELECT body, timestamp, response FROM requests WHERE id = ?", requestID).Scan(&body, &timestamp, &responseJSON)
	if err != nil {
		return fmt.Errorf("failed to fetch request: %w", err)
	}

	// Extract fields from response
	var statusCode *int
	var streaming *int
	var stopReason *string
	var responseID *string
	var responseRole *string
	var responseSignature *string
	if responseJSON.Valid {
		var resp struct {
			StatusCode  int             `json:"statusCode"`
			IsStreaming bool            `json:"isStreaming"`
			Body        json.RawMessage `json:"body"`
		}
		if err := json.Unmarshal([]byte(responseJSON.String), &resp); err == nil {
			if resp.StatusCode != 0 {
				statusCode = &resp.StatusCode
			}
			streamVal := 0
			if resp.IsStreaming {
				streamVal = 1
			}
			streaming = &streamVal

			// Extract stop_reason, id, role, and content signature from body
			if len(resp.Body) > 0 {
				var respBody struct {
					StopReason string `json:"stop_reason"`
					ID         string `json:"id"`
					Role       string `json:"role"`
					Content    []struct {
						Type string `json:"type"`
						Name string `json:"name,omitempty"`
					} `json:"content"`
				}
				if err := json.Unmarshal(resp.Body, &respBody); err == nil {
					if respBody.StopReason != "" {
						stopReason = &respBody.StopReason
					}
					if respBody.ID != "" {
						responseID = &respBody.ID
					}
					if respBody.Role != "" {
						responseRole = &respBody.Role
					}
					// Build signature from content types
					if len(respBody.Content) > 0 {
						types := make([]string, len(respBody.Content))
						for i, c := range respBody.Content {
							t := c.Type
							if t == "tool_use" && c.Name != "" {
								t = "tool_use=" + c.Name
							}
							types[i] = t
						}
						sig := strings.Join(types, ",")
						responseSignature = &sig
					}
				}
			}
		}

		// Fallback: parse streamingChunks if content is empty (streaming responses)
		if responseSignature == nil || stopReason == nil {
			var respWithChunks struct {
				StreamingChunks []string `json:"streamingChunks"`
			}
			if err := json.Unmarshal([]byte(responseJSON.String), &respWithChunks); err == nil && len(respWithChunks.StreamingChunks) > 0 {
				contentTypes, sr := parseStreamingChunks(respWithChunks.StreamingChunks)
				if responseSignature == nil && len(contentTypes) > 0 {
					sig := strings.Join(contentTypes, ",")
					responseSignature = &sig
				}
				if stopReason == nil && sr != "" {
					stopReason = &sr
				}
			}
		}
	}

	var request struct {
		Messages []json.RawMessage `json:"messages"`
		System   json.RawMessage   `json:"system"`
		Tools    json.RawMessage   `json:"tools"`
	}

	if err := json.Unmarshal([]byte(body), &request); err != nil {
		return fmt.Errorf("failed to parse request body: %w", err)
	}

	if len(request.Messages) == 0 {
		return nil
	}

	// Estimate tokens for system prompts and tools
	systemTokens := estimateSystemTokens(request.System)
	toolsTokens := estimateToolsTokens(request.Tools)

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Prepare statements
	lookupStmt, err := tx.Prepare("SELECT id FROM message_content WHERE message_hash = ?")
	if err != nil {
		return err
	}
	defer lookupStmt.Close()

	insertContentStmt, err := tx.Prepare(`
		INSERT INTO message_content (message_hash, role, signature, content, token_estimate, created_by)
		VALUES (?, ?, ?, ?, ?, ?)
		RETURNING id
	`)
	if err != nil {
		return err
	}
	defer insertContentStmt.Close()

	insertMsgStmt, err := tx.Prepare(`
		INSERT INTO messages (id, message_position, timestamp, message_hash, message_id, kind)
		VALUES (?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer insertMsgStmt.Close()

	var contextIDs []string
	var lastMessageID int64
	numMessages := len(request.Messages)

	for msgPos, msgRaw := range request.Messages {
		// Parse message to get role and content
		var msg struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		}
		if err := json.Unmarshal(msgRaw, &msg); err != nil {
			return fmt.Errorf("failed to parse message %d: %w", msgPos, err)
		}

		// Normalize message (remove cache_control) before hashing and storing
		normalizedMsg := normalizeMessage(msgRaw)
		messageHash := sha256Hash(normalizedMsg)

		// Try to find existing message_content
		var messageID int64
		err := lookupStmt.QueryRow(messageHash).Scan(&messageID)
		if err == sql.ErrNoRows {
			// Need to insert new content
			signature := computeSignature(msg.Content)
			tokenEstimate := estimateTokens(normalizedMsg)
			err = insertContentStmt.QueryRow(messageHash, msg.Role, signature, string(normalizedMsg), tokenEstimate, requestID).Scan(&messageID)
			if err != nil {
				return fmt.Errorf("failed to insert message_content: %w", err)
			}
		} else if err != nil {
			return fmt.Errorf("failed to lookup message_content: %w", err)
		}

		// Insert into messages (kind: 0=context, 1=last message)
		kind := 0
		if msgPos == numMessages-1 {
			kind = 1
		}
		_, err = insertMsgStmt.Exec(requestID, msgPos, timestamp, messageHash, messageID, kind)
		if err != nil {
			return fmt.Errorf("failed to insert message: %w", err)
		}

		// Track for requests_context
		lastMessageID = messageID
		contextIDs = append(contextIDs, strconv.FormatInt(messageID, 10))
	}

	// Insert into requests_context (context excludes last message, new_context includes it)
	context := ""
	contextMsgCount := 0
	if len(contextIDs) > 1 {
		context = strings.Join(contextIDs[:len(contextIDs)-1], ",")
		contextMsgCount = len(contextIDs) - 1
	}
	newContext := strings.Join(contextIDs, ",")

	// Create message_content record for response
	var responseMessageID *int64
	if responseJSON.Valid {
		var responseMsg json.RawMessage

		// Try non-streaming first (has body.content)
		var resp struct {
			Body json.RawMessage `json:"body"`
		}
		if err := json.Unmarshal([]byte(responseJSON.String), &resp); err == nil && len(resp.Body) > 0 {
			responseMsg = extractNonStreamingResponse(resp.Body)
		}

		// Try streaming if non-streaming didn't work
		if responseMsg == nil {
			var respWithChunks struct {
				StreamingChunks []string `json:"streamingChunks"`
			}
			if err := json.Unmarshal([]byte(responseJSON.String), &respWithChunks); err == nil && len(respWithChunks.StreamingChunks) > 0 {
				responseMsg = reconstructStreamingResponse(respWithChunks.StreamingChunks)
			}
		}

		// If we have response content, create message_content record
		if responseMsg != nil && len(responseMsg) > 0 {
			// Parse to get role and compute signature
			var respMsgParsed struct {
				Role    string          `json:"role"`
				Content json.RawMessage `json:"content"`
			}
			if err := json.Unmarshal(responseMsg, &respMsgParsed); err == nil {
				normalizedResp := normalizeMessage(responseMsg)
				respHash := sha256Hash(normalizedResp)

				var respMsgID int64
				err := lookupStmt.QueryRow(respHash).Scan(&respMsgID)
				if err == sql.ErrNoRows {
					respSignature := computeSignature(respMsgParsed.Content)
					respTokenEstimate := estimateTokens(normalizedResp)
					err = insertContentStmt.QueryRow(respHash, respMsgParsed.Role, respSignature, string(normalizedResp), respTokenEstimate, requestID).Scan(&respMsgID)
					if err != nil {
						// Log but don't fail - response is optional
						fmt.Fprintf(os.Stderr, "Warning: failed to insert response message_content: %v\n", err)
					} else {
						responseMessageID = &respMsgID
					}
				} else if err == nil {
					responseMessageID = &respMsgID
				}
			}
		}
	}

	_, err = tx.Exec(`
		INSERT INTO requests_context (id, timestamp, last_message_id, context, new_context, context_msg_count, status_code, streaming, stop_reason, response_id, response_role, response_signature, response_message_id, system_tokens, tools_tokens)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, requestID, timestamp, lastMessageID, context, newContext, contextMsgCount, statusCode, streaming, stopReason, responseID, responseRole, responseSignature, responseMessageID, systemTokens, toolsTokens)
	if err != nil {
		return fmt.Errorf("failed to insert requests_context: %w", err)
	}

	return tx.Commit()
}

// parseStreamingChunks extracts content types and stop_reason from SSE streaming chunks
func parseStreamingChunks(chunks []string) (contentTypes []string, stopReason string) {
	for _, chunk := range chunks {
		data := strings.TrimPrefix(chunk, "data: ")
		var event map[string]interface{}
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			continue
		}

		eventType, _ := event["type"].(string)
		switch eventType {
		case "content_block_start":
			if cb, ok := event["content_block"].(map[string]interface{}); ok {
				if t, ok := cb["type"].(string); ok {
					// For tool_use, include the tool name
					if t == "tool_use" {
						if name, ok := cb["name"].(string); ok && name != "" {
							t = "tool_use=" + name
						}
					}
					contentTypes = append(contentTypes, t)
				}
			}
		case "message_delta":
			if delta, ok := event["delta"].(map[string]interface{}); ok {
				if sr, ok := delta["stop_reason"].(string); ok && sr != "" {
					stopReason = sr
				}
			}
		}
	}
	return
}

// reconstructStreamingResponse builds response message content from SSE streaming chunks
func reconstructStreamingResponse(chunks []string) json.RawMessage {
	// Track content blocks by index
	type contentBlock struct {
		Type     string
		Text     string // for text blocks
		Thinking string // for thinking blocks
		Input    string // for tool_use input (accumulated JSON string)
		ID       string // for tool_use
		Name     string // for tool_use
	}
	var blocks []contentBlock

	for _, chunk := range chunks {
		data := strings.TrimPrefix(chunk, "data: ")
		var event map[string]interface{}
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			continue
		}

		eventType, _ := event["type"].(string)
		switch eventType {
		case "content_block_start":
			idx, _ := event["index"].(float64)
			// Ensure blocks slice is large enough
			for len(blocks) <= int(idx) {
				blocks = append(blocks, contentBlock{})
			}
			if cb, ok := event["content_block"].(map[string]interface{}); ok {
				blocks[int(idx)].Type, _ = cb["type"].(string)
				blocks[int(idx)].ID, _ = cb["id"].(string)
				blocks[int(idx)].Name, _ = cb["name"].(string)
				// Initial values if present
				if text, ok := cb["text"].(string); ok {
					blocks[int(idx)].Text = text
				}
				if thinking, ok := cb["thinking"].(string); ok {
					blocks[int(idx)].Thinking = thinking
				}
			}
		case "content_block_delta":
			idx, _ := event["index"].(float64)
			if int(idx) < len(blocks) {
				if delta, ok := event["delta"].(map[string]interface{}); ok {
					deltaType, _ := delta["type"].(string)
					switch deltaType {
					case "text_delta":
						if text, ok := delta["text"].(string); ok {
							blocks[int(idx)].Text += text
						}
					case "thinking_delta":
						if thinking, ok := delta["thinking"].(string); ok {
							blocks[int(idx)].Thinking += thinking
						}
					case "input_json_delta":
						if partialJSON, ok := delta["partial_json"].(string); ok {
							blocks[int(idx)].Input += partialJSON
						}
					}
				}
			}
		}
	}

	// Build content array
	var content []map[string]interface{}
	for _, block := range blocks {
		cb := map[string]interface{}{"type": block.Type}
		switch block.Type {
		case "text":
			cb["text"] = block.Text
		case "thinking":
			cb["thinking"] = block.Thinking
		case "tool_use":
			cb["id"] = block.ID
			cb["name"] = block.Name
			// Parse accumulated JSON string into proper object
			var input interface{}
			if err := json.Unmarshal([]byte(block.Input), &input); err == nil {
				cb["input"] = input
			} else {
				cb["input"] = block.Input // fallback to string
			}
		}
		content = append(content, cb)
	}

	// Build message
	msg := map[string]interface{}{
		"role":    "assistant",
		"content": content,
	}
	result, _ := json.Marshal(msg)
	return result
}

// extractNonStreamingResponse extracts response content from non-streaming response body
func extractNonStreamingResponse(body json.RawMessage) json.RawMessage {
	var resp struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil
	}
	if resp.Role == "" || len(resp.Content) == 0 ||
		string(resp.Content) == "null" || string(resp.Content) == "[]" {
		return nil
	}

	// Build message in same format as request messages
	msg := map[string]interface{}{
		"role":    resp.Role,
		"content": json.RawMessage(resp.Content),
	}
	result, _ := json.Marshal(msg)
	return result
}

// computeSignature extracts content types and joins them with ","
func computeSignature(content json.RawMessage) string {
	// Try to parse as array first
	var contentArray []struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(content, &contentArray); err == nil {
		types := make([]string, len(contentArray))
		for i, c := range contentArray {
			types[i] = c.Type
		}
		return strings.Join(types, ",")
	}

	// If it's a string, signature is just "text"
	var contentStr string
	if err := json.Unmarshal(content, &contentStr); err == nil {
		return "text"
	}

	return ""
}

// estimateTokens counts tokens in message content blocks using tiktoken cl100k_base encoding
func estimateTokens(normalizedMsg json.RawMessage) int {
	enc, err := tokenizer.Get(tokenizer.Cl100kBase)
	if err != nil {
		return 0
	}

	var msg struct {
		Content json.RawMessage `json:"content"`
	}
	if err := json.Unmarshal(normalizedMsg, &msg); err != nil {
		return 0
	}

	// Try to parse content as array of blocks
	var blocks []map[string]interface{}
	if err := json.Unmarshal(msg.Content, &blocks); err != nil {
		// Try as string
		var text string
		if err := json.Unmarshal(msg.Content, &text); err == nil {
			ids, _, _ := enc.Encode(text)
			return len(ids)
		}
		return 0
	}

	total := 0
	for _, block := range blocks {
		// Count tokens from text fields in content blocks
		for key, val := range block {
			switch key {
			case "text", "thinking", "content": // text blocks, thinking blocks, tool_result content
				if s, ok := val.(string); ok {
					ids, _, _ := enc.Encode(s)
					total += len(ids)
				}
			case "input": // tool_use input - serialize and count
				if inputBytes, err := json.Marshal(val); err == nil {
					ids, _, _ := enc.Encode(string(inputBytes))
					total += len(ids)
				}
			}
		}
	}
	return total
}

// estimateSystemTokens counts tokens in system prompts
func estimateSystemTokens(systemRaw json.RawMessage) int {
	if len(systemRaw) == 0 {
		return 0
	}

	enc, err := tokenizer.Get(tokenizer.Cl100kBase)
	if err != nil {
		return 0
	}

	// System can be a string or array of objects with text field
	var systemStr string
	if err := json.Unmarshal(systemRaw, &systemStr); err == nil {
		ids, _, _ := enc.Encode(systemStr)
		return len(ids)
	}

	var systemArr []struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(systemRaw, &systemArr); err == nil {
		total := 0
		for _, s := range systemArr {
			ids, _, _ := enc.Encode(s.Text)
			total += len(ids)
		}
		return total
	}

	return 0
}

// estimateToolsTokens counts tokens in tools definitions
func estimateToolsTokens(toolsRaw json.RawMessage) int {
	if len(toolsRaw) == 0 {
		return 0
	}

	enc, err := tokenizer.Get(tokenizer.Cl100kBase)
	if err != nil {
		return 0
	}

	// Serialize the entire tools array and count tokens
	ids, _, _ := enc.Encode(string(toolsRaw))
	return len(ids)
}
