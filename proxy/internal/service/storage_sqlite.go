package service

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"

	"github.com/seifghazi/claude-code-monitor/internal/config"
	"github.com/seifghazi/claude-code-monitor/internal/model"
)

type sqliteStorageService struct {
	db     *sql.DB
	config *config.StorageConfig
}

func NewSQLiteStorageService(cfg *config.StorageConfig) (StorageService, error) {
	// WAL mode for better concurrency, busy timeout to wait on locks, relaxed sync for performance
	dbPath := cfg.DBPath + "?_journal_mode=WAL&_busy_timeout=5000&_synchronous=NORMAL"
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	service := &sqliteStorageService{
		db:     db,
		config: cfg,
	}

	if err := service.createTables(); err != nil {
		return nil, fmt.Errorf("failed to create tables: %w", err)
	}

	return service, nil
}

func (s *sqliteStorageService) createTables() error {
	schema := `
	CREATE TABLE IF NOT EXISTS requests (
		id TEXT PRIMARY KEY,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
		method TEXT NOT NULL,
		endpoint TEXT NOT NULL,
		headers TEXT NOT NULL,
		body TEXT NOT NULL,
		user_agent TEXT,
		content_type TEXT,
		prompt_grade TEXT,
		response TEXT,
		model TEXT,
		original_model TEXT,
		routed_model TEXT,
		tokens_input BIGINT,
		tokens_output BIGINT,
		tokens_cached BIGINT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_timestamp ON requests(timestamp DESC);
	CREATE INDEX IF NOT EXISTS idx_endpoint ON requests(endpoint);
	CREATE INDEX IF NOT EXISTS idx_model ON requests(model);

	CREATE TABLE IF NOT EXISTS usage (
		id TEXT PRIMARY KEY,
		input_tokens BIGINT,
		cache_creation_input_tokens BIGINT,
		cache_read_input_tokens BIGINT,
		cache_creation_ephemeral_5m_input_tokens BIGINT,
		cache_creation_ephemeral_1h_input_tokens BIGINT,
		output_tokens BIGINT,
		service_tier TEXT,
		request_bytes BIGINT,
		request_messages BIGINT,
		response_bytes BIGINT
	);

	CREATE TABLE IF NOT EXISTS pricing (
		model TEXT NOT NULL PRIMARY KEY,
		display_name TEXT NOT NULL,
		family TEXT NOT NULL,
		pricing_date DATE NOT NULL DEFAULT CURRENT_DATE,
		pricing_tier TEXT NOT NULL DEFAULT 'standard',
		input_tokens REAL NOT NULL DEFAULT 1.00,
		output_tokens REAL NOT NULL DEFAULT 5.00,
		cache_read_input_tokens REAL NOT NULL DEFAULT 0.10,
		cache_creation_ephemeral_5m_input_tokens REAL NOT NULL DEFAULT 1.25,
		cache_creation_ephemeral_1h_input_tokens REAL NOT NULL DEFAULT 2.00
	);

	INSERT OR IGNORE INTO pricing (model, display_name, family) VALUES ('default', 'Default', 'default');
	`

	_, err := s.db.Exec(schema)
	if err != nil {
		return err
	}

	// Create views (SQLite doesn't support CREATE OR REPLACE VIEW)
	views := []string{
		`DROP VIEW IF EXISTS usage_with_pricing`,
		`CREATE VIEW usage_with_pricing AS
		SELECT
			u.id,
			COALESCE(u.input_tokens, 0) as input_tokens,
			COALESCE(u.cache_creation_input_tokens, 0) as cache_creation_input_tokens,
			COALESCE(u.cache_read_input_tokens, 0) as cache_read_input_tokens,
			COALESCE(u.cache_creation_ephemeral_5m_input_tokens, 0) as cache_creation_ephemeral_5m_input_tokens,
			COALESCE(u.cache_creation_ephemeral_1h_input_tokens, 0) as cache_creation_ephemeral_1h_input_tokens,
			COALESCE(u.output_tokens, 0) as output_tokens,
			COALESCE(u.service_tier, '') as service_tier,
			COALESCE(r.timestamp, '') as timestamp,
			COALESCE(r.user_agent, '') as user_agent,
			COALESCE(r.model, '') as model,
			p.pricing_date,
			p.pricing_tier,
			p.input_tokens as price_input_tokens,
			p.output_tokens as price_output_tokens,
			p.cache_read_input_tokens as price_cache_read_input_tokens,
			p.cache_creation_ephemeral_5m_input_tokens as price_cache_creation_ephemeral_5m_input_tokens,
			p.cache_creation_ephemeral_1h_input_tokens as price_cache_creation_ephemeral_1h_input_tokens
		FROM usage u
		LEFT JOIN requests r ON u.id = r.id
		INNER JOIN pricing p ON p.model = 'default'`,
		`DROP VIEW IF EXISTS usage_price_breakdown`,
		`CREATE VIEW usage_price_breakdown AS
		WITH costs AS (
			SELECT
				*,
				input_tokens * price_input_tokens as input_cost,
				case 
					when cache_creation_ephemeral_5m_input_tokens + cache_creation_ephemeral_1h_input_tokens > 0 then 
						0 
					else 
						cache_creation_input_tokens 
				end * price_input_tokens as cache_creation_cost,
				cache_read_input_tokens * price_cache_read_input_tokens as cache_read_cost,
				cache_creation_ephemeral_5m_input_tokens * price_cache_creation_ephemeral_5m_input_tokens as cache_5m_cost,
				cache_creation_ephemeral_1h_input_tokens * price_cache_creation_ephemeral_1h_input_tokens as cache_1h_cost,
				output_tokens * price_output_tokens as output_cost
			FROM usage_with_pricing
		),
		costs_with_total AS (
			SELECT 
				*,
				input_cost 
					+ cache_read_cost 
					+ case 
						when cache_5m_cost + cache_1h_cost = 0 then 
							cache_creation_cost 
						else 
							cache_5m_cost + cache_1h_cost 
					end 
					+ output_cost as total_cost
			FROM
				costs
		)
		SELECT
			*,
			ROUND(100.0 * input_cost / NULLIF(total_cost, 0), 1) as input_pct,
			ROUND(100.0 * cache_creation_cost / NULLIF(total_cost, 0), 1) as cache_creation_pct,
			ROUND(100.0 * cache_read_cost / NULLIF(total_cost, 0), 1) as cache_read_pct,
			ROUND(100.0 * cache_5m_cost / NULLIF(total_cost, 0), 1) as cache_5m_pct,
			ROUND(100.0 * cache_1h_cost / NULLIF(total_cost, 0), 1) as cache_1h_pct,
			ROUND(100.0 * output_cost / NULLIF(total_cost, 0), 1) as output_pct
		FROM costs_with_total`,
	}

	for _, v := range views {
		if _, err := s.db.Exec(v); err != nil {
			return fmt.Errorf("failed to create view: %w", err)
		}
	}

	return nil
}

func (s *sqliteStorageService) SaveRequest(request *model.RequestLog) (string, error) {
	headersJSON, err := json.Marshal(request.Headers)
	if err != nil {
		return "", fmt.Errorf("failed to marshal headers: %w", err)
	}

	bodyJSON, err := json.Marshal(request.Body)
	if err != nil {
		return "", fmt.Errorf("failed to marshal body: %w", err)
	}

	query := `
		INSERT INTO requests (id, timestamp, method, endpoint, headers, body, user_agent, content_type, model, original_model, routed_model)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	_, err = s.db.Exec(query,
		request.RequestID,
		request.Timestamp,
		request.Method,
		request.Endpoint,
		string(headersJSON),
		string(bodyJSON),
		request.UserAgent,
		request.ContentType,
		request.Model,
		request.OriginalModel,
		request.RoutedModel,
	)

	if err != nil {
		return "", fmt.Errorf("failed to insert request: %w", err)
	}

	log.Printf("💾 [DB_INSERT] id=%s model=%s",
		request.RequestID, request.Model)

	return request.RequestID, nil
}

func (s *sqliteStorageService) GetRequests(page, limit int) ([]model.RequestLog, int, error) {
	// Get total count
	var total int
	err := s.db.QueryRow("SELECT COUNT(*) FROM requests").Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get total count: %w", err)
	}

	// Get paginated results
	offset := (page - 1) * limit
	query := `
		SELECT id, timestamp, method, endpoint, headers, body, model, user_agent, content_type, prompt_grade, response, original_model, routed_model, tokens_input, tokens_output, tokens_cached
		FROM requests
		ORDER BY timestamp DESC
		LIMIT ? OFFSET ?
	`

	rows, err := s.db.Query(query, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to query requests: %w", err)
	}
	defer rows.Close()

	var requests []model.RequestLog
	for rows.Next() {
		var req model.RequestLog
		var headersJSON, bodyJSON string
		var promptGradeJSON, responseJSON sql.NullString
		var tokensInput, tokensOutput, tokensCached sql.NullInt64

		err := rows.Scan(
			&req.RequestID,
			&req.Timestamp,
			&req.Method,
			&req.Endpoint,
			&headersJSON,
			&bodyJSON,
			&req.Model,
			&req.UserAgent,
			&req.ContentType,
			&promptGradeJSON,
			&responseJSON,
			&req.OriginalModel,
			&req.RoutedModel,
			&tokensInput,
			&tokensOutput,
			&tokensCached,
		)
		if err != nil {
			// Error scanning row - skip
			continue
		}

		// Unmarshal JSON fields
		if err := json.Unmarshal([]byte(headersJSON), &req.Headers); err != nil {
			// Error unmarshaling headers
			continue
		}

		var body interface{}
		if err := json.Unmarshal([]byte(bodyJSON), &body); err != nil {
			// Error unmarshaling body
			continue
		}
		req.Body = body

		if promptGradeJSON.Valid {
			var grade model.PromptGrade
			if err := json.Unmarshal([]byte(promptGradeJSON.String), &grade); err == nil {
				req.PromptGrade = &grade
			}
		}

		if responseJSON.Valid {
			var resp model.ResponseLog
			if err := json.Unmarshal([]byte(responseJSON.String), &resp); err == nil {
				req.Response = &resp
			}
		}

		if tokensInput.Valid {
			req.TokensInput = tokensInput.Int64
		}
		if tokensOutput.Valid {
			req.TokensOutput = tokensOutput.Int64
		}
		if tokensCached.Valid {
			req.TokensCached = tokensCached.Int64
		}

		requests = append(requests, req)
	}

	return requests, total, nil
}

func (s *sqliteStorageService) ClearRequests() (int, error) {
	result, err := s.db.Exec("DELETE FROM requests")
	if err != nil {
		return 0, fmt.Errorf("failed to clear requests: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("failed to get rows affected: %w", err)
	}

	return int(rowsAffected), nil
}

func (s *sqliteStorageService) UpdateRequestWithGrading(requestID string, grade *model.PromptGrade) error {
	gradeJSON, err := json.Marshal(grade)
	if err != nil {
		return fmt.Errorf("failed to marshal grade: %w", err)
	}

	query := "UPDATE requests SET prompt_grade = ? WHERE id = ?"
	_, err = s.db.Exec(query, string(gradeJSON), requestID)
	if err != nil {
		return fmt.Errorf("failed to update request with grading: %w", err)
	}

	return nil
}

func (s *sqliteStorageService) UpdateRequestWithResponse(request *model.RequestLog) error {
	responseJSON, err := json.Marshal(request.Response)
	if err != nil {
		return fmt.Errorf("failed to marshal response: %w", err)
	}

	// Calculate request bytes and message count
	var requestBytes, requestMessages int64
	if request.Body != nil {
		if bodyBytes, err := json.Marshal(request.Body); err == nil {
			requestBytes = int64(len(bodyBytes))
		}
		// Try to extract message count from request body
		if bodyMap, ok := request.Body.(map[string]interface{}); ok {
			if messages, ok := bodyMap["messages"].([]interface{}); ok {
				requestMessages = int64(len(messages))
			}
		} else if anthReq, ok := request.Body.(*model.AnthropicRequest); ok {
			requestMessages = int64(len(anthReq.Messages))
		} else if anthReq, ok := request.Body.(model.AnthropicRequest); ok {
			requestMessages = int64(len(anthReq.Messages))
		}
	}

	// Extract token counts from response body
	var tokensInput, tokensOutput, tokensCached int64
	var responseBytes int64
	if request.Response != nil && len(request.Response.Body) > 0 {
		responseBytes = int64(len(request.Response.Body))
		var respBody struct {
			Usage struct {
				InputTokens          int64 `json:"input_tokens"`
				OutputTokens         int64 `json:"output_tokens"`
				CacheReadInputTokens int64 `json:"cache_read_input_tokens"`
			} `json:"usage"`
		}
		if err := json.Unmarshal(request.Response.Body, &respBody); err == nil {
			tokensInput = respBody.Usage.InputTokens
			tokensOutput = respBody.Usage.OutputTokens
			tokensCached = respBody.Usage.CacheReadInputTokens
		}

		// Save detailed usage to usage table
		s.saveUsage(request.RequestID, request.Response.Body, requestBytes, requestMessages, responseBytes)
	}

	query := "UPDATE requests SET response = ?, tokens_input = ?, tokens_output = ?, tokens_cached = ? WHERE id = ?"
	_, err = s.db.Exec(query, string(responseJSON), tokensInput, tokensOutput, tokensCached, request.RequestID)
	if err != nil {
		return fmt.Errorf("failed to update request with response: %w", err)
	}

	statusCode := 0
	if request.Response != nil {
		statusCode = request.Response.StatusCode
	}
	log.Printf("💾 [DB_UPDATE] id=%s status=%d tokens_in=%d tokens_out=%d",
		request.RequestID, statusCode, tokensInput, tokensOutput)

	return nil
}

func (s *sqliteStorageService) saveUsage(requestID string, responseBody []byte, requestBytes, requestMessages, responseBytes int64) {
	// Known fields in usage
	knownFields := map[string]bool{
		"input_tokens":                true,
		"cache_creation_input_tokens": true,
		"cache_read_input_tokens":     true,
		"cache_creation":              true,
		"output_tokens":               true,
		"service_tier":                true,
	}
	knownCacheCreationFields := map[string]bool{
		"ephemeral_5m_input_tokens": true,
		"ephemeral_1h_input_tokens": true,
	}

	// Parse usage as raw map to detect unknown fields
	var respBody struct {
		Usage map[string]interface{} `json:"usage"`
	}
	if err := json.Unmarshal(responseBody, &respBody); err != nil {
		return
	}
	if respBody.Usage == nil {
		return
	}

	// Check for unknown fields
	for key := range respBody.Usage {
		if !knownFields[key] {
			log.Printf("WARNING: Unknown usage field: %s", key)
		}
	}

	// Check cache_creation for unknown fields
	if cacheCreation, ok := respBody.Usage["cache_creation"].(map[string]interface{}); ok {
		for key := range cacheCreation {
			if !knownCacheCreationFields[key] {
				log.Printf("WARNING: Unknown usage.cache_creation field: %s", key)
			}
		}
	}

	// Parse with typed struct for insertion
	var usage struct {
		Usage struct {
			InputTokens              int64  `json:"input_tokens"`
			CacheCreationInputTokens int64  `json:"cache_creation_input_tokens"`
			CacheReadInputTokens     int64  `json:"cache_read_input_tokens"`
			OutputTokens             int64  `json:"output_tokens"`
			ServiceTier              string `json:"service_tier"`
			CacheCreation            struct {
				Ephemeral5mInputTokens int64 `json:"ephemeral_5m_input_tokens"`
				Ephemeral1hInputTokens int64 `json:"ephemeral_1h_input_tokens"`
			} `json:"cache_creation"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(responseBody, &usage); err != nil {
		log.Printf("WARNING: Failed to parse usage for saving: %v", err)
		return
	}

	query := `
		INSERT OR REPLACE INTO usage (
			id, input_tokens, cache_creation_input_tokens, cache_read_input_tokens,
			cache_creation_ephemeral_5m_input_tokens, cache_creation_ephemeral_1h_input_tokens,
			output_tokens, service_tier, request_bytes, request_messages, response_bytes
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`
	_, err := s.db.Exec(query,
		requestID,
		usage.Usage.InputTokens,
		usage.Usage.CacheCreationInputTokens,
		usage.Usage.CacheReadInputTokens,
		usage.Usage.CacheCreation.Ephemeral5mInputTokens,
		usage.Usage.CacheCreation.Ephemeral1hInputTokens,
		usage.Usage.OutputTokens,
		usage.Usage.ServiceTier,
		requestBytes,
		requestMessages,
		responseBytes,
	)
	if err != nil {
		log.Printf("WARNING: Failed to save usage: %v", err)
	}
}

func (s *sqliteStorageService) EnsureDirectoryExists() error {
	// No directory needed for SQLite
	return nil
}

func (s *sqliteStorageService) GetRequestByShortID(shortID string) (*model.RequestLog, string, error) {
	query := `
		SELECT id, timestamp, method, endpoint, headers, body, model, user_agent, content_type, prompt_grade, response, original_model, routed_model, tokens_input, tokens_output, tokens_cached
		FROM requests
		WHERE id LIKE ?
		ORDER BY timestamp DESC
		LIMIT 1
	`

	var req model.RequestLog
	var headersJSON, bodyJSON string
	var promptGradeJSON, responseJSON sql.NullString
	var tokensInput, tokensOutput, tokensCached sql.NullInt64

	err := s.db.QueryRow(query, "%"+shortID).Scan(
		&req.RequestID,
		&req.Timestamp,
		&req.Method,
		&req.Endpoint,
		&headersJSON,
		&bodyJSON,
		&req.Model,
		&req.UserAgent,
		&req.ContentType,
		&promptGradeJSON,
		&responseJSON,
		&req.OriginalModel,
		&req.RoutedModel,
		&tokensInput,
		&tokensOutput,
		&tokensCached,
	)

	if err == sql.ErrNoRows {
		return nil, "", fmt.Errorf("request with ID %s not found", shortID)
	}
	if err != nil {
		return nil, "", fmt.Errorf("failed to query request: %w", err)
	}

	// Unmarshal JSON fields
	if err := json.Unmarshal([]byte(headersJSON), &req.Headers); err != nil {
		return nil, "", fmt.Errorf("failed to unmarshal headers: %w", err)
	}

	var body interface{}
	if err := json.Unmarshal([]byte(bodyJSON), &body); err != nil {
		return nil, "", fmt.Errorf("failed to unmarshal body: %w", err)
	}
	req.Body = body

	if promptGradeJSON.Valid {
		var grade model.PromptGrade
		if err := json.Unmarshal([]byte(promptGradeJSON.String), &grade); err == nil {
			req.PromptGrade = &grade
		}
	}

	if responseJSON.Valid {
		var resp model.ResponseLog
		if err := json.Unmarshal([]byte(responseJSON.String), &resp); err == nil {
			req.Response = &resp
		}
	}

	if tokensInput.Valid {
		req.TokensInput = tokensInput.Int64
	}
	if tokensOutput.Valid {
		req.TokensOutput = tokensOutput.Int64
	}
	if tokensCached.Valid {
		req.TokensCached = tokensCached.Int64
	}

	return &req, req.RequestID, nil
}

func (s *sqliteStorageService) GetConfig() *config.StorageConfig {
	return s.config
}

func (s *sqliteStorageService) GetAllRequests(modelFilter string) ([]*model.RequestLog, error) {
	query := `
		SELECT r.id, r.timestamp, r.method, r.endpoint, r.headers, r.body, r.model, r.user_agent, r.content_type, r.prompt_grade, r.response, r.original_model, r.routed_model, r.tokens_input, r.tokens_output, r.tokens_cached,
			COALESCE(u.cache_creation_input_tokens, 0) as cache_creation_tokens,
			COALESCE(u.cache_read_input_tokens, 0) as cache_read_tokens
		FROM requests r
		LEFT JOIN usage u ON r.id = u.id
	`
	args := []interface{}{}

	if modelFilter != "" && modelFilter != "all" {
		query += " WHERE LOWER(r.model) LIKE ?"
		args = append(args, "%"+strings.ToLower(modelFilter)+"%")

	}

	query += " ORDER BY r.timestamp DESC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query requests: %w", err)
	}
	defer rows.Close()

	var requests []*model.RequestLog
	for rows.Next() {
		var req model.RequestLog
		var headersJSON, bodyJSON string
		var promptGradeJSON, responseJSON sql.NullString
		var tokensInput, tokensOutput, tokensCached sql.NullInt64
		var cacheCreationTokens, cacheReadTokens int64

		err := rows.Scan(
			&req.RequestID,
			&req.Timestamp,
			&req.Method,
			&req.Endpoint,
			&headersJSON,
			&bodyJSON,
			&req.Model,
			&req.UserAgent,
			&req.ContentType,
			&promptGradeJSON,
			&responseJSON,
			&req.OriginalModel,
			&req.RoutedModel,
			&tokensInput,
			&tokensOutput,
			&tokensCached,
			&cacheCreationTokens,
			&cacheReadTokens,
		)
		if err != nil {
			// Error scanning row - skip
			continue
		}

		// Unmarshal JSON fields
		if err := json.Unmarshal([]byte(headersJSON), &req.Headers); err != nil {
			// Error unmarshaling headers
			continue
		}

		var body interface{}
		if err := json.Unmarshal([]byte(bodyJSON), &body); err != nil {
			// Error unmarshaling body
			continue
		}
		req.Body = body

		if promptGradeJSON.Valid {
			var grade model.PromptGrade
			if err := json.Unmarshal([]byte(promptGradeJSON.String), &grade); err == nil {
				req.PromptGrade = &grade
			}
		}

		if responseJSON.Valid {
			var resp model.ResponseLog
			if err := json.Unmarshal([]byte(responseJSON.String), &resp); err == nil {
				req.Response = &resp
			}
		}

		if tokensInput.Valid {
			req.TokensInput = tokensInput.Int64
		}
		if tokensOutput.Valid {
			req.TokensOutput = tokensOutput.Int64
		}
		if tokensCached.Valid {
			req.TokensCached = tokensCached.Int64
		}
		req.CacheCreationTokens = cacheCreationTokens
		req.CacheReadTokens = cacheReadTokens

		requests = append(requests, &req)
	}

	return requests, nil
}

func (s *sqliteStorageService) Close() error {
	return s.db.Close()
}

// GetRequestsSummary returns minimal data for list view with date filtering
func (s *sqliteStorageService) GetRequestsSummary(modelFilter, startTime, endTime string) ([]*model.RequestSummary, int, error) {
	// First get total count
	countQuery := "SELECT COUNT(*) FROM requests"
	countArgs := []interface{}{}
	whereClauses := []string{}

	if modelFilter != "" && modelFilter != "all" {
		whereClauses = append(whereClauses, "LOWER(model) LIKE ?")
		countArgs = append(countArgs, "%"+strings.ToLower(modelFilter)+"%")
	}

	if startTime != "" && endTime != "" {
		whereClauses = append(whereClauses, "datetime(timestamp) >= datetime(?) AND datetime(timestamp) <= datetime(?)")
		countArgs = append(countArgs, startTime, endTime)
	}

	if len(whereClauses) > 0 {
		countQuery += " WHERE " + strings.Join(whereClauses, " AND ")
	}

	var total int
	if err := s.db.QueryRow(countQuery, countArgs...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("failed to get total count: %w", err)
	}

	// Then get the data
	query := `
		SELECT id, timestamp, method, endpoint, model, original_model, routed_model, response
		FROM requests
	`
	args := []interface{}{}
	queryWhereClauses := []string{}

	if modelFilter != "" && modelFilter != "all" {
		queryWhereClauses = append(queryWhereClauses, "LOWER(model) LIKE ?")
		args = append(args, "%"+strings.ToLower(modelFilter)+"%")
	}

	if startTime != "" && endTime != "" {
		queryWhereClauses = append(queryWhereClauses, "datetime(timestamp) >= datetime(?) AND datetime(timestamp) <= datetime(?)")
		args = append(args, startTime, endTime)
	}

	if len(queryWhereClauses) > 0 {
		query += " WHERE " + strings.Join(queryWhereClauses, " AND ")
	}

	query += " ORDER BY timestamp DESC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to query requests: %w", err)
	}
	defer rows.Close()

	var summaries []*model.RequestSummary
	for rows.Next() {
		var sum model.RequestSummary
		var responseJSON sql.NullString

		err := rows.Scan(
			&sum.RequestID,
			&sum.Timestamp,
			&sum.Method,
			&sum.Endpoint,
			&sum.Model,
			&sum.OriginalModel,
			&sum.RoutedModel,
			&responseJSON,
		)
		if err != nil {
			continue
		}

		// Only parse response to extract usage and status
		if responseJSON.Valid {
			var resp model.ResponseLog
			if err := json.Unmarshal([]byte(responseJSON.String), &resp); err == nil {
				sum.StatusCode = resp.StatusCode
				sum.ResponseTime = resp.ResponseTime

				// Extract usage from response body
				if resp.Body != nil {
					var respBody struct {
						Usage *model.AnthropicUsage `json:"usage"`
					}
					if err := json.Unmarshal(resp.Body, &respBody); err == nil && respBody.Usage != nil {
						sum.Usage = respBody.Usage
					}
				}
			}
		}

		summaries = append(summaries, &sum)
	}

	return summaries, total, nil
}

// GetStats returns aggregated statistics for the dashboard
func (s *sqliteStorageService) GetStats(startDate, endDate string) (*model.DashboardStats, error) {
	stats := &model.DashboardStats{
		DailyStats: make([]model.DailyTokens, 0),
	}

	query := `
		SELECT timestamp, COALESCE(model, 'unknown') as model, response
		FROM requests
		WHERE datetime(timestamp) >= datetime(?) AND datetime(timestamp) <= datetime(?)
		ORDER BY timestamp
	`

	rows, err := s.db.Query(query, startDate, endDate)
	if err != nil {
		return nil, fmt.Errorf("failed to query stats: %w", err)
	}
	defer rows.Close()

	dailyMap := make(map[string]*model.DailyTokens)

	for rows.Next() {
		var timestamp, modelName, responseJSON string

		if err := rows.Scan(&timestamp, &modelName, &responseJSON); err != nil {
			continue
		}

		// Extract date from timestamp
		date := strings.Split(timestamp, "T")[0]

		// Parse response to get usage
		var resp model.ResponseLog
		if err := json.Unmarshal([]byte(responseJSON), &resp); err != nil {
			continue
		}

		var usage *model.AnthropicUsage
		if resp.Body != nil {
			var respBody struct {
				Usage *model.AnthropicUsage `json:"usage"`
			}
			if err := json.Unmarshal(resp.Body, &respBody); err == nil {
				usage = respBody.Usage
			}
		}

		tokens := int64(0)
		if usage != nil {
			tokens = int64(usage.InputTokens + usage.OutputTokens + usage.CacheReadInputTokens + usage.CacheCreationInputTokens)
		}

		// Daily aggregation
		if daily, ok := dailyMap[date]; ok {
			daily.Tokens += tokens
			daily.Requests++
			if daily.Models == nil {
				daily.Models = make(map[string]model.ModelStats)
			}
			if modelStat, ok := daily.Models[modelName]; ok {
				modelStat.Tokens += tokens
				modelStat.Requests++
				daily.Models[modelName] = modelStat
			} else {
				daily.Models[modelName] = model.ModelStats{Tokens: tokens, Requests: 1}
			}
		} else {
			dailyMap[date] = &model.DailyTokens{
				Date:     date,
				Tokens:   tokens,
				Requests: 1,
				Models:   map[string]model.ModelStats{modelName: {Tokens: tokens, Requests: 1}},
			}
		}
	}

	for _, v := range dailyMap {
		stats.DailyStats = append(stats.DailyStats, *v)
	}

	return stats, nil
}

// GetHourlyStats returns hourly breakdown for a specific time range
func (s *sqliteStorageService) GetHourlyStats(startTime, endTime string) (*model.HourlyStatsResponse, error) {
	query := `
		SELECT timestamp, COALESCE(model, 'unknown') as model, response
		FROM requests
		WHERE datetime(timestamp) >= datetime(?) AND datetime(timestamp) <= datetime(?)
		ORDER BY timestamp
	`

	rows, err := s.db.Query(query, startTime, endTime)
	if err != nil {
		return nil, fmt.Errorf("failed to query hourly stats: %w", err)
	}
	defer rows.Close()

	hourlyMap := make(map[int]*model.HourlyTokens)
	var totalTokens int64
	var totalRequests int
	var totalResponseTime int64
	var responseCount int

	for rows.Next() {
		var timestamp, modelName, responseJSON string

		if err := rows.Scan(&timestamp, &modelName, &responseJSON); err != nil {
			continue
		}

		// Extract hour from timestamp
		hour := 0
		if t, err := time.Parse(time.RFC3339, timestamp); err == nil {
			hour = t.Hour()
		}

		// Parse response
		var resp model.ResponseLog
		if err := json.Unmarshal([]byte(responseJSON), &resp); err != nil {
			continue
		}

		var usage *model.AnthropicUsage
		if resp.Body != nil {
			var respBody struct {
				Usage *model.AnthropicUsage `json:"usage"`
			}
			if err := json.Unmarshal(resp.Body, &respBody); err == nil {
				usage = respBody.Usage
			}
		}

		tokens := int64(0)
		if usage != nil {
			tokens = int64(usage.InputTokens + usage.OutputTokens + usage.CacheReadInputTokens + usage.CacheCreationInputTokens)
		}

		totalTokens += tokens
		totalRequests++

		if resp.ResponseTime > 0 {
			totalResponseTime += resp.ResponseTime
			responseCount++
		}

		// Hourly aggregation
		if hourly, ok := hourlyMap[hour]; ok {
			hourly.Tokens += tokens
			hourly.Requests++
			if hourly.Models == nil {
				hourly.Models = make(map[string]model.ModelStats)
			}
			if modelStat, ok := hourly.Models[modelName]; ok {
				modelStat.Tokens += tokens
				modelStat.Requests++
				hourly.Models[modelName] = modelStat
			} else {
				hourly.Models[modelName] = model.ModelStats{Tokens: tokens, Requests: 1}
			}
		} else {
			hourlyMap[hour] = &model.HourlyTokens{
				Hour:     hour,
				Tokens:   tokens,
				Requests: 1,
				Models:   map[string]model.ModelStats{modelName: {Tokens: tokens, Requests: 1}},
			}
		}
	}

	hourlyStats := make([]model.HourlyTokens, 0)
	for _, v := range hourlyMap {
		hourlyStats = append(hourlyStats, *v)
	}

	avgResponseTime := int64(0)
	if responseCount > 0 {
		avgResponseTime = totalResponseTime / int64(responseCount)
	}

	return &model.HourlyStatsResponse{
		HourlyStats:     hourlyStats,
		TodayTokens:     totalTokens,
		TodayRequests:   totalRequests,
		AvgResponseTime: avgResponseTime,
	}, nil
}

// GetModelStats returns model breakdown for a specific time range
func (s *sqliteStorageService) GetModelStats(startTime, endTime string) (*model.ModelStatsResponse, error) {
	query := `
		SELECT timestamp, COALESCE(model, 'unknown') as model, response
		FROM requests
		WHERE datetime(timestamp) >= datetime(?) AND datetime(timestamp) <= datetime(?)
		ORDER BY timestamp
	`

	rows, err := s.db.Query(query, startTime, endTime)
	if err != nil {
		return nil, fmt.Errorf("failed to query model stats: %w", err)
	}
	defer rows.Close()

	modelMap := make(map[string]*model.ModelTokens)

	for rows.Next() {
		var timestamp, modelName, responseJSON string

		if err := rows.Scan(&timestamp, &modelName, &responseJSON); err != nil {
			continue
		}

		// Parse response
		var resp model.ResponseLog
		if err := json.Unmarshal([]byte(responseJSON), &resp); err != nil {
			continue
		}

		var usage *model.AnthropicUsage
		if resp.Body != nil {
			var respBody struct {
				Usage *model.AnthropicUsage `json:"usage"`
			}
			if err := json.Unmarshal(resp.Body, &respBody); err == nil {
				usage = respBody.Usage
			}
		}

		tokens := int64(0)
		if usage != nil {
			tokens = int64(usage.InputTokens + usage.OutputTokens + usage.CacheReadInputTokens + usage.CacheCreationInputTokens)
		}

		if modelStat, ok := modelMap[modelName]; ok {
			modelStat.Tokens += tokens
			modelStat.Requests++
		} else {
			modelMap[modelName] = &model.ModelTokens{Model: modelName, Tokens: tokens, Requests: 1}
		}
	}

	modelStats := make([]model.ModelTokens, 0)
	for _, v := range modelMap {
		modelStats = append(modelStats, *v)
	}

	return &model.ModelStatsResponse{ModelStats: modelStats}, nil
}

// GetLatestRequestDate returns the timestamp of the most recent request
func (s *sqliteStorageService) GetLatestRequestDate() (*time.Time, error) {
	var timestamp string
	err := s.db.QueryRow("SELECT timestamp FROM requests ORDER BY timestamp DESC LIMIT 1").Scan(&timestamp)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query latest request: %w", err)
	}

	t, err := time.Parse(time.RFC3339, timestamp)
	if err != nil {
		return nil, fmt.Errorf("failed to parse timestamp: %w", err)
	}

	return &t, nil
}

func (s *sqliteStorageService) GetUsage(page, limit int, sortBy, sortOrder string) ([]model.UsageRecord, int, error) {
	// Get total count
	var total int
	err := s.db.QueryRow("SELECT COUNT(*) FROM usage_price_breakdown").Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get total count: %w", err)
	}

	// Validate sort column
	validColumns := map[string]string{
		"id":                                       "id",
		"input_tokens":                             "input_tokens",
		"cache_creation_input_tokens":              "cache_creation_input_tokens",
		"cache_read_input_tokens":                  "cache_read_input_tokens",
		"cache_creation_ephemeral_5m_input_tokens": "cache_creation_ephemeral_5m_input_tokens",
		"cache_creation_ephemeral_1h_input_tokens": "cache_creation_ephemeral_1h_input_tokens",
		"output_tokens":                            "output_tokens",
		"service_tier":                             "service_tier",
		"timestamp":                                "timestamp",
		"user_agent":                               "user_agent",
		"model":                                    "model",
		"input_cost":                               "input_cost",
		"cache_creation_cost":                      "cache_creation_cost",
		"cache_read_cost":                          "cache_read_cost",
		"cache_5m_cost":                            "cache_5m_cost",
		"cache_1h_cost":                            "cache_1h_cost",
		"output_cost":                              "output_cost",
		"total_cost":                               "total_cost",
	}
	sortColumn, ok := validColumns[sortBy]
	if !ok {
		sortColumn = "timestamp"
	}

	// Validate sort order
	if sortOrder != "ASC" && sortOrder != "DESC" {
		sortOrder = "DESC"
	}

	// Build ORDER BY clause - add timestamp as secondary sort if not already sorting by timestamp
	orderClause := fmt.Sprintf("%s %s", sortColumn, sortOrder)
	if sortColumn != "timestamp" {
		orderClause += ", timestamp DESC"
	}

	// Get all results from the view (no pagination)
	query := fmt.Sprintf(`
		SELECT
			id, input_tokens, cache_creation_input_tokens, cache_read_input_tokens,
			cache_creation_ephemeral_5m_input_tokens, cache_creation_ephemeral_1h_input_tokens,
			output_tokens, service_tier, timestamp, user_agent, model,
			input_cost, cache_creation_cost, cache_read_cost, cache_5m_cost, cache_1h_cost, output_cost, total_cost,
			COALESCE(input_pct, 0), COALESCE(cache_creation_pct, 0), COALESCE(cache_read_pct, 0),
			COALESCE(cache_5m_pct, 0), COALESCE(cache_1h_pct, 0), COALESCE(output_pct, 0)
		FROM usage_price_breakdown
		ORDER BY %s
	`, orderClause)

	rows, err := s.db.Query(query)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to query usage: %w", err)
	}
	defer rows.Close()

	var records []model.UsageRecord
	for rows.Next() {
		var rec model.UsageRecord
		err := rows.Scan(
			&rec.ID,
			&rec.InputTokens,
			&rec.CacheCreationInputTokens,
			&rec.CacheReadInputTokens,
			&rec.CacheCreationEphemeral5mInputTokens,
			&rec.CacheCreationEphemeral1hInputTokens,
			&rec.OutputTokens,
			&rec.ServiceTier,
			&rec.Timestamp,
			&rec.UserAgent,
			&rec.Model,
			&rec.InputCost,
			&rec.CacheCreationCost,
			&rec.CacheReadCost,
			&rec.Cache5mCost,
			&rec.Cache1hCost,
			&rec.OutputCost,
			&rec.TotalCost,
			&rec.InputPct,
			&rec.CacheCreationPct,
			&rec.CacheReadPct,
			&rec.Cache5mPct,
			&rec.Cache1hPct,
			&rec.OutputPct,
		)
		if err != nil {
			continue
		}
		records = append(records, rec)
	}

	return records, total, nil
}

func (s *sqliteStorageService) GetPricing() ([]model.PricingModel, error) {
	query := `
		SELECT model, display_name, family, pricing_date, pricing_tier,
			input_tokens, output_tokens, cache_read_input_tokens,
			cache_creation_ephemeral_5m_input_tokens, cache_creation_ephemeral_1h_input_tokens
		FROM pricing
		ORDER BY family, model
	`

	rows, err := s.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query pricing: %w", err)
	}
	defer rows.Close()

	var models []model.PricingModel
	for rows.Next() {
		var p model.PricingModel
		err := rows.Scan(
			&p.Model,
			&p.DisplayName,
			&p.Family,
			&p.PricingDate,
			&p.PricingTier,
			&p.InputTokens,
			&p.OutputTokens,
			&p.CacheReadInputTokens,
			&p.CacheCreationEphemeral5mInputTokens,
			&p.CacheCreationEphemeral1hInputTokens,
		)
		if err != nil {
			continue
		}
		models = append(models, p)
	}

	return models, nil
}

func (s *sqliteStorageService) GetHourlyUsage() ([]model.HourlyUsage, error) {
	query := `
		SELECT
			strftime('%Y-%m-%d %H:00', r.timestamp) as hour,
			COALESCE(SUM(u.input_tokens), 0) + COALESCE(SUM(u.cache_creation_input_tokens), 0) as input_tokens,
			COALESCE(SUM(u.output_tokens), 0) as output_tokens,
			COALESCE(SUM(u.cache_creation_input_tokens), 0) as cache_create,
			COALESCE(SUM(u.cache_read_input_tokens), 0) as cache_read
		FROM requests r
		LEFT JOIN usage u ON r.id = u.id
		WHERE r.timestamp IS NOT NULL
		GROUP BY strftime('%Y-%m-%d %H:00', r.timestamp)
		ORDER BY hour ASC
	`

	rows, err := s.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query hourly usage: %w", err)
	}
	defer rows.Close()

	var results []model.HourlyUsage
	for rows.Next() {
		var h model.HourlyUsage
		err := rows.Scan(&h.Hour, &h.InputTokens, &h.OutputTokens, &h.CacheCreate, &h.CacheRead)
		if err != nil {
			continue
		}
		results = append(results, h)
	}

	return results, nil
}

// GetTurns returns turn summaries with context information for a date range
func (s *sqliteStorageService) GetTurns(startTime, endTime, sortBy, sortOrder string) ([]model.TurnSummary, int, error) {
	// Validate sort column
	validColumns := map[string]string{
		"timestamp":         "rcs.timestamp",
		"model":             "r.model",
		"messageCount":      "message_count",
		"lastMessageId":     "rcs.last_message_id",
		"requestRole":       "request_role",
		"requestSignature":  "request_signature",
		"responseRole":      "rcs.response_role",
		"responseSignature": "rcs.response_signature",
		"streaming":         "rcs.streaming",
		"totalTokens":       "total_tokens",
		"cacheReads":        "cache_reads",
	}
	sortColumn, ok := validColumns[sortBy]
	if !ok {
		sortColumn = "rcs.timestamp"
	}

	if sortOrder != "ASC" && sortOrder != "DESC" {
		sortOrder = "DESC"
	}

	query := fmt.Sprintf(`
		SELECT
			rcs.id,
			rcs.timestamp,
			rcs.context,
			rcs.context_display,
			rcs.context_size + 1 as message_count,
			rcs.last_message_id,
			rcs.streaming,
			rcs.stop_reason,
			r.model,
			mc.role as request_role,
			mc.signature as request_signature,
			COALESCE(u.request_bytes, 0) as request_bytes,
			rcs.response_role,
			rcs.response_signature,
			rcs.response_message_id,
			COALESCE(u.response_bytes, 0) as response_bytes,
			CASE
				WHEN COALESCE(u.input_tokens, 0) + COALESCE(u.cache_creation_input_tokens, 0) > 200000 THEN NULL
				ELSE COALESCE(u.input_tokens, 0) + COALESCE(u.cache_creation_input_tokens, 0)
			END as input_tokens,
			CASE
				WHEN COALESCE(u.input_tokens, 0) + COALESCE(u.cache_creation_input_tokens, 0) > 200000 THEN NULL
				ELSE COALESCE(u.output_tokens, 0)
			END as output_tokens,
			CASE
				WHEN COALESCE(u.input_tokens, 0) + COALESCE(u.cache_creation_input_tokens, 0) > 200000 THEN NULL
				ELSE COALESCE(u.cache_read_input_tokens, 0)
			END as cache_reads,
			COALESCE(json_array_length(r.body, '$.system'), 0) as system_count,
			COALESCE(json_array_length(r.body, '$.tools'), 0) as tools_count,
			CASE
				WHEN json_extract(mc.content, '$.content[0].text') LIKE '[%%' THEN 'LLM'
				WHEN COALESCE(json_array_length(r.body, '$.tools'), 0) = 1 THEN 'LLM'
				WHEN mc.role = 'user' AND mc.signature = 'text' AND COALESCE(json_array_length(r.body, '$.tools'), 0) > 0 THEN 'Prompt'
				WHEN mc.role = 'user' AND mc.signature = 'text' AND COALESCE(json_array_length(r.body, '$.tools'), 0) = 0 THEN 'Agent'
				ELSE 'LLM'
			END as reason,
			CASE
				WHEN (COALESCE((
					SELECT SUM(mc2.token_estimate)
					FROM messages m2
					JOIN message_content mc2 ON m2.message_id = mc2.id
					WHERE m2.id = rcs.id AND m2.kind = 0
				), 0) + COALESCE(rcs.system_tokens, 0) + COALESCE(rcs.tools_tokens, 0)) > 200000 THEN NULL
				ELSE COALESCE((
					SELECT SUM(mc2.token_estimate)
					FROM messages m2
					JOIN message_content mc2 ON m2.message_id = mc2.id
					WHERE m2.id = rcs.id AND m2.kind = 0
				), 0) + COALESCE(rcs.system_tokens, 0) + COALESCE(rcs.tools_tokens, 0)
			END as context_tokens,
			CASE
				WHEN COALESCE(mc.token_estimate, 0) > 200000 THEN NULL
				ELSE COALESCE(mc.token_estimate, 0)
			END as last_msg_tokens,
			CASE
				WHEN COALESCE(resp_mc.token_estimate, 0) > 200000 THEN NULL
				WHEN resp_mc.token_estimate > 0 THEN resp_mc.token_estimate + 100
				ELSE COALESCE(resp_mc.token_estimate, 0)
			END as response_tokens
		FROM requests_context_summary rcs
		JOIN requests r ON rcs.id = r.id
		LEFT JOIN message_content mc ON rcs.last_message_id = mc.id
		LEFT JOIN message_content resp_mc ON rcs.response_message_id = resp_mc.id
		LEFT JOIN usage u ON rcs.id = u.id
		WHERE datetime(rcs.timestamp) >= datetime(?)
		  AND datetime(rcs.timestamp) <= datetime(?)
		ORDER BY %s %s
	`, sortColumn, sortOrder)

	rows, err := s.db.Query(query, startTime, endTime)
	if err != nil {
		log.Printf("GetTurns SQL error: %v\nQuery: %s\nArgs: start=%s end=%s", err, query, startTime, endTime)
		return nil, 0, fmt.Errorf("failed to query turns: %w", err)
	}
	defer rows.Close()

	var turns []model.TurnSummary
	for rows.Next() {
		var t model.TurnSummary
		var streaming, responseMessageID sql.NullInt64
		var inputTokens, outputTokens, cacheReads, contextTokens, lastMsgTokens, responseTokens sql.NullInt64
		var stopReason, requestRole, requestSignature, responseRole, responseSignature sql.NullString

		err := rows.Scan(
			&t.ID,
			&t.Timestamp,
			&t.Context,
			&t.ContextDisplay,
			&t.MessageCount,
			&t.LastMessageID,
			&streaming,
			&stopReason,
			&t.Model,
			&requestRole,
			&requestSignature,
			&t.RequestBytes,
			&responseRole,
			&responseSignature,
			&responseMessageID,
			&t.ResponseBytes,
			&inputTokens,
			&outputTokens,
			&cacheReads,
			&t.SystemCount,
			&t.ToolsCount,
			&t.Reason,
			&contextTokens,
			&lastMsgTokens,
			&responseTokens,
		)
		if err != nil {
			continue
		}

		if streaming.Valid {
			val := streaming.Int64 == 1
			t.Streaming = &val
		}
		if stopReason.Valid {
			t.StopReason = &stopReason.String
		}
		if requestRole.Valid {
			t.RequestRole = &requestRole.String
		}
		if requestSignature.Valid {
			t.RequestSignature = &requestSignature.String
		}
		if responseRole.Valid {
			t.ResponseRole = &responseRole.String
		}
		if responseSignature.Valid {
			t.ResponseSignature = &responseSignature.String
		}
		if responseMessageID.Valid {
			t.ResponseMessageID = &responseMessageID.Int64
		}
		if inputTokens.Valid {
			t.InputTokens = inputTokens.Int64
		}
		if outputTokens.Valid {
			t.OutputTokens = outputTokens.Int64
		}
		if cacheReads.Valid {
			t.CacheReads = cacheReads.Int64
		}
		if contextTokens.Valid {
			t.ContextTokens = contextTokens.Int64
		}
		if lastMsgTokens.Valid {
			t.LastMsgTokens = lastMsgTokens.Int64
		}
		if responseTokens.Valid {
			t.ResponseTokens = responseTokens.Int64
		}

		turns = append(turns, t)
	}

	return turns, len(turns), nil
}

// GetMessageContent returns the content of a specific message by ID
func (s *sqliteStorageService) GetMessageContent(id int64) (*model.MessageContentRecord, error) {
	query := `
		SELECT id, role, signature, content, created_at
		FROM message_content
		WHERE id = ?
	`

	var rec model.MessageContentRecord
	var content string
	err := s.db.QueryRow(query, id).Scan(
		&rec.ID,
		&rec.Role,
		&rec.Signature,
		&content,
		&rec.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("message content with ID %d not found", id)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query message content: %w", err)
	}

	rec.Content = json.RawMessage(content)
	return &rec, nil
}
