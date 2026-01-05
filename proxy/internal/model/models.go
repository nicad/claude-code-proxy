package model

import (
	"encoding/json"
	"time"
)

type ContextKey string

const BodyBytesKey ContextKey = "bodyBytes"

type PromptGrade struct {
	Score            int                      `json:"score"`
	MaxScore         int                      `json:"maxScore"`
	Feedback         string                   `json:"feedback"`
	ImprovedPrompt   string                   `json:"improvedPrompt"`
	Criteria         map[string]CriteriaScore `json:"criteria"`
	GradingTimestamp string                   `json:"gradingTimestamp"`
	IsProcessing     bool                     `json:"isProcessing"`
}

type CriteriaScore struct {
	Score    int    `json:"score"`
	Feedback string `json:"feedback"`
}

type RequestLog struct {
	RequestID            string              `json:"requestId"`
	Timestamp            string              `json:"timestamp"`
	Method               string              `json:"method"`
	Endpoint             string              `json:"endpoint"`
	Headers              map[string][]string `json:"headers"`
	Body                 interface{}         `json:"body"`
	Model                string              `json:"model,omitempty"`
	OriginalModel        string              `json:"originalModel,omitempty"`
	RoutedModel          string              `json:"routedModel,omitempty"`
	UserAgent            string              `json:"userAgent"`
	ContentType          string              `json:"contentType"`
	PromptGrade          *PromptGrade        `json:"promptGrade,omitempty"`
	Response             *ResponseLog        `json:"response,omitempty"`
	TokensInput          int64               `json:"tokensInput,omitempty"`
	TokensOutput         int64               `json:"tokensOutput,omitempty"`
	TokensCached         int64               `json:"tokensCached,omitempty"`
	CacheCreationTokens  int64               `json:"cacheCreationTokens,omitempty"`
	CacheReadTokens      int64               `json:"cacheReadTokens,omitempty"`
}

type ResponseLog struct {
	StatusCode      int                 `json:"statusCode"`
	Headers         map[string][]string `json:"headers"`
	Body            json.RawMessage     `json:"body,omitempty"`
	BodyText        string              `json:"bodyText,omitempty"`
	ResponseTime    int64               `json:"responseTime"`
	StreamingChunks []string            `json:"streamingChunks,omitempty"`
	IsStreaming     bool                `json:"isStreaming"`
	CompletedAt     string              `json:"completedAt"`
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatCompletionRequest struct {
	Model    string        `json:"model"`
	Messages []ChatMessage `json:"messages"`
	Stream   bool          `json:"stream,omitempty"`
}

type AnthropicUsage struct {
	InputTokens              int    `json:"input_tokens"`
	OutputTokens             int    `json:"output_tokens"`
	CacheCreationInputTokens int    `json:"cache_creation_input_tokens,omitempty"`
	CacheReadInputTokens     int    `json:"cache_read_input_tokens,omitempty"`
	ServiceTier              string `json:"service_tier,omitempty"`
}

type AnthropicResponse struct {
	Content      []AnthropicContentBlock `json:"content"`
	ID           string                  `json:"id"`
	Model        string                  `json:"model"`
	Role         string                  `json:"role"`
	StopReason   string                  `json:"stop_reason"`
	StopSequence *string                 `json:"stop_sequence"`
	Type         string                  `json:"type"`
	Usage        AnthropicUsage          `json:"usage"`
}

type AnthropicContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type AnthropicMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"`
}

func (m *AnthropicMessage) GetContentBlocks() []AnthropicContentBlock {
	switch v := m.Content.(type) {
	case string:
		return []AnthropicContentBlock{{Type: "text", Text: v}}
	case []interface{}:
		var blocks []AnthropicContentBlock
		for _, item := range v {
			if block, ok := item.(map[string]interface{}); ok {
				if typ, hasType := block["type"].(string); hasType {
					if text, hasText := block["text"].(string); hasText {
						blocks = append(blocks, AnthropicContentBlock{Type: typ, Text: text})
					}
				}
			}
		}
		return blocks
	case []AnthropicContentBlock:
		return v
	default:
		return []AnthropicContentBlock{}
	}
}

type AnthropicSystemMessage struct {
	Text         string        `json:"text"`
	Type         string        `json:"type"`
	CacheControl *CacheControl `json:"cache_control,omitempty"`
}

type CacheControl struct {
	Type string `json:"type"`
}

type Tool struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	InputSchema InputSchema `json:"input_schema"`
}

type InputSchema struct {
	Type       string                 `json:"type"`
	Properties map[string]interface{} `json:"properties"`
	Required   []string               `json:"required,omitempty"`
}

type AnthropicRequest struct {
	Model       string                   `json:"model"`
	Messages    []AnthropicMessage       `json:"messages"`
	MaxTokens   int                      `json:"max_tokens"`
	Temperature *float64                 `json:"temperature,omitempty"`
	System      []AnthropicSystemMessage `json:"system,omitempty"`
	Stream      bool                     `json:"stream,omitempty"`
	Tools       []Tool                   `json:"tools,omitempty"`
	ToolChoice  interface{}              `json:"tool_choice,omitempty"`
}

type ModelsResponse struct {
	Object string      `json:"object"`
	Data   []ModelInfo `json:"data"`
}

type ModelInfo struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	OwnedBy string `json:"owned_by"`
}

type GradeRequest struct {
	Messages       []AnthropicMessage       `json:"messages"`
	SystemMessages []AnthropicSystemMessage `json:"systemMessages"`
	RequestID      string                   `json:"requestId,omitempty"`
}

type HealthResponse struct {
	Status    string    `json:"status"`
	Timestamp time.Time `json:"timestamp"`
}

type ErrorResponse struct {
	Error   string `json:"error"`
	Details string `json:"details,omitempty"`
}

type StreamingEvent struct {
	Type         string        `json:"type"`
	Index        *int          `json:"index,omitempty"`
	Delta        *Delta        `json:"delta,omitempty"`
	ContentBlock *ContentBlock `json:"content_block,omitempty"`
}

type Delta struct {
	Type  string          `json:"type,omitempty"`
	Text  string          `json:"text,omitempty"`
	Name  string          `json:"name,omitempty"`
	Input json.RawMessage `json:"input,omitempty"`
}

type ContentBlock struct {
	Type  string          `json:"type"`
	ID    string          `json:"id,omitempty"`
	Name  string          `json:"name,omitempty"`
	Input json.RawMessage `json:"input,omitempty"`
	Text  string          `json:"text,omitempty"`
}

type UsageRecord struct {
	ID                                   string  `json:"id"`
	InputTokens                          int64   `json:"input_tokens"`
	CacheCreationInputTokens             int64   `json:"cache_creation_input_tokens"`
	CacheReadInputTokens                 int64   `json:"cache_read_input_tokens"`
	CacheCreationEphemeral5mInputTokens  int64   `json:"cache_creation_ephemeral_5m_input_tokens"`
	CacheCreationEphemeral1hInputTokens  int64   `json:"cache_creation_ephemeral_1h_input_tokens"`
	OutputTokens                         int64   `json:"output_tokens"`
	ServiceTier                          string  `json:"service_tier"`
	Timestamp                            string  `json:"timestamp"`
	UserAgent                            string  `json:"user_agent"`
	Model                                string  `json:"model"`
	// Cost fields
	InputCost         float64 `json:"input_cost"`
	CacheCreationCost float64 `json:"cache_creation_cost"`
	CacheReadCost     float64 `json:"cache_read_cost"`
	Cache5mCost       float64 `json:"cache_5m_cost"`
	Cache1hCost       float64 `json:"cache_1h_cost"`
	OutputCost        float64 `json:"output_cost"`
	TotalCost         float64 `json:"total_cost"`
	// Percentage fields
	InputPct         float64 `json:"input_pct"`
	CacheCreationPct float64 `json:"cache_creation_pct"`
	CacheReadPct     float64 `json:"cache_read_pct"`
	Cache5mPct       float64 `json:"cache_5m_pct"`
	Cache1hPct       float64 `json:"cache_1h_pct"`
	OutputPct        float64 `json:"output_pct"`
}

type HourlyUsage struct {
	Hour         string `json:"hour"`
	InputTokens  int64  `json:"input_tokens"`
	OutputTokens int64  `json:"output_tokens"`
	CacheCreate  int64  `json:"cache_create"`
	CacheRead    int64  `json:"cache_read"`
}

type PricingModel struct {
	Model                                string  `json:"model"`
	DisplayName                          string  `json:"display_name"`
	Family                               string  `json:"family"`
	PricingDate                          string  `json:"pricing_date"`
	PricingTier                          string  `json:"pricing_tier"`
	InputTokens                          float64 `json:"input_tokens"`
	OutputTokens                         float64 `json:"output_tokens"`
	CacheReadInputTokens                 float64 `json:"cache_read_input_tokens"`
	CacheCreationEphemeral5mInputTokens  float64 `json:"cache_creation_ephemeral_5m_input_tokens"`
	CacheCreationEphemeral1hInputTokens  float64 `json:"cache_creation_ephemeral_1h_input_tokens"`
}

// RequestSummary is a lightweight version of RequestLog for list views
type RequestSummary struct {
	RequestID     string          `json:"requestId"`
	Timestamp     string          `json:"timestamp"`
	Method        string          `json:"method"`
	Endpoint      string          `json:"endpoint"`
	Model         string          `json:"model,omitempty"`
	OriginalModel string          `json:"originalModel,omitempty"`
	RoutedModel   string          `json:"routedModel,omitempty"`
	StatusCode    int             `json:"statusCode,omitempty"`
	ResponseTime  int64           `json:"responseTime,omitempty"`
	Usage         *AnthropicUsage `json:"usage,omitempty"`
}

// Dashboard stats structures
type DashboardStats struct {
	DailyStats []DailyTokens `json:"dailyStats"`
}

type HourlyStatsResponse struct {
	HourlyStats     []HourlyTokens `json:"hourlyStats"`
	TodayTokens     int64          `json:"todayTokens"`
	TodayRequests   int            `json:"todayRequests"`
	AvgResponseTime int64          `json:"avgResponseTime"`
}

type ModelStatsResponse struct {
	ModelStats []ModelTokens `json:"modelStats"`
}

type DailyTokens struct {
	Date     string                `json:"date"`
	Tokens   int64                 `json:"tokens"`
	Requests int                   `json:"requests"`
	Models   map[string]ModelStats `json:"models,omitempty"`
}

type HourlyTokens struct {
	Hour     int                   `json:"hour"`
	Tokens   int64                 `json:"tokens"`
	Requests int                   `json:"requests"`
	Models   map[string]ModelStats `json:"models,omitempty"`
}

type ModelStats struct {
	Tokens   int64 `json:"tokens"`
	Requests int   `json:"requests"`
}

type ModelTokens struct {
	Model    string `json:"model"`
	Tokens   int64  `json:"tokens"`
	Requests int    `json:"requests"`
}

// TurnSummary represents a request with its context summary for the Turns tab
type TurnSummary struct {
	ID                string  `json:"id"`
	Timestamp         string  `json:"timestamp"`
	Model             string  `json:"model"`
	Context           string  `json:"context"`
	ContextDisplay    string  `json:"contextDisplay"`
	MessageCount      int     `json:"messageCount"`
	LastMessageID     int64   `json:"lastMessageId"`
	RequestRole       *string `json:"requestRole"`
	RequestSignature  *string `json:"requestSignature"`
	RequestBytes      int64   `json:"requestBytes"`
	ResponseRole      *string `json:"responseRole"`
	ResponseSignature *string `json:"responseSignature"`
	ResponseBytes     int64   `json:"responseBytes"`
	Streaming         *bool   `json:"streaming"`
	StopReason        *string `json:"stopReason"`
	TotalTokens       int64   `json:"totalTokens"`
	CacheReads        int64   `json:"cacheReads"`
	SystemCount       int     `json:"systemCount"`
	ToolsCount        int     `json:"toolsCount"`
}

// MessageContentRecord represents a message stored in the message_content table
type MessageContentRecord struct {
	ID        int64           `json:"id"`
	Role      string          `json:"role"`
	Signature string          `json:"signature"`
	Content   json.RawMessage `json:"content"`
	CreatedAt string          `json:"createdAt"`
}
