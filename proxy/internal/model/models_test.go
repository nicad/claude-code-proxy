package model

import (
	"encoding/json"
	"testing"
)

func TestSystemPromptUnmarshal(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected []AnthropicSystemMessage
	}{
		{
			name:  "string format",
			input: `{"system": "You are a helpful assistant"}`,
			expected: []AnthropicSystemMessage{
				{Type: "text", Text: "You are a helpful assistant"},
			},
		},
		{
			name:  "array format",
			input: `{"system": [{"type": "text", "text": "You are a helpful assistant"}]}`,
			expected: []AnthropicSystemMessage{
				{Type: "text", Text: "You are a helpful assistant"},
			},
		},
		{
			name:  "array with cache control",
			input: `{"system": [{"type": "text", "text": "System prompt", "cache_control": {"type": "ephemeral"}}]}`,
			expected: []AnthropicSystemMessage{
				{Type: "text", Text: "System prompt", CacheControl: &CacheControl{Type: "ephemeral"}},
			},
		},
		{
			name:     "empty/null",
			input:    `{}`,
			expected: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var req struct {
				System SystemPrompt `json:"system,omitempty"`
			}
			err := json.Unmarshal([]byte(tt.input), &req)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(req.System) != len(tt.expected) {
				t.Fatalf("expected %d messages, got %d", len(tt.expected), len(req.System))
			}
			for i, msg := range req.System {
				if msg.Text != tt.expected[i].Text {
					t.Errorf("message %d: expected text %q, got %q", i, tt.expected[i].Text, msg.Text)
				}
				if msg.Type != tt.expected[i].Type {
					t.Errorf("message %d: expected type %q, got %q", i, tt.expected[i].Type, msg.Type)
				}
			}
		})
	}
}

func TestAnthropicRequestUnmarshal(t *testing.T) {
	// Test full request with string system
	input := `{
		"model": "claude-3-5-sonnet-20241022",
		"max_tokens": 1024,
		"system": "You are a helpful assistant",
		"messages": [{"role": "user", "content": "Hello"}]
	}`

	var req AnthropicRequest
	if err := json.Unmarshal([]byte(input), &req); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if req.Model != "claude-3-5-sonnet-20241022" {
		t.Errorf("expected model claude-3-5-sonnet-20241022, got %s", req.Model)
	}
	if len(req.System) != 1 {
		t.Fatalf("expected 1 system message, got %d", len(req.System))
	}
	if req.System[0].Text != "You are a helpful assistant" {
		t.Errorf("expected system text 'You are a helpful assistant', got %q", req.System[0].Text)
	}
}
