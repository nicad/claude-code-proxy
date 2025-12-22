# Code Overview

A transparent proxy for monitoring Claude Code API requests with a web dashboard.

## Architecture

```
Claude Code → Go Proxy (3001) → Anthropic/OpenAI APIs
                   ↓
              SQLite DB
                   ↓
           Remix Web App (5173)
```

---

## Proxy (Go)

### External Packages

| Package | Purpose |
|---------|---------|
| `github.com/gorilla/mux` | HTTP request routing |
| `github.com/gorilla/handlers` | CORS and HTTP middleware |
| `github.com/mattn/go-sqlite3` | SQLite database driver |
| `github.com/joho/godotenv` | Environment variable loading |
| `gopkg.in/yaml.v3` | YAML configuration parsing |

### Database Writes

The database is written from `proxy/internal/service/storage_sqlite.go`:

- **`SaveRequest()`** (line ~75): Inserts new request records when API calls are intercepted
- **`UpdateRequestWithResponse()`** (line ~115): Updates the record with response data when the upstream API responds

The flow:
1. `handler/handlers.go:Messages()` receives the proxied request
2. Creates a `RequestLog` struct with request metadata
3. Calls `storageService.SaveRequest()` to persist to SQLite
4. Forwards to Anthropic/OpenAI, receives response
5. Calls `storageService.UpdateRequestWithResponse()` to store the response

---

## Web App (Remix/React)

### External Libraries

**Framework:**
- `@remix-run/node`, `@remix-run/react`, `@remix-run/serve` - Remix framework

**UI:**
- `react`, `react-dom` - UI framework
- `lucide-react` - Icons
- `tailwindcss` - Styling

**Build:**
- `vite` - Build tool
- `typescript` - Type checking

### Database Access

The web app does **not** access SQLite directly. It communicates with the Go backend via HTTP:

| Web Route | Backend Endpoint |
|-----------|------------------|
| `routes/api.requests.tsx` | `GET/DELETE http://localhost:3001/api/requests` |
| `routes/api.conversations.tsx` | `GET http://localhost:3001/api/conversations` |
| `routes/api.grade-prompt.tsx` | `POST http://localhost:3001/api/grade-prompt` |

The main dashboard (`routes/_index.tsx`) fetches data from these API routes, which forward to the Go backend. The backend queries SQLite and returns JSON.

---

## Request ID (Local DB Identifier)

The Request ID is generated in `proxy/internal/handler/handlers.go:540-544`:

```go
func generateRequestID() string {
    bytes := make([]byte, 8)
    rand.Read(bytes)
    return hex.EncodeToString(bytes)
}
```

- Uses `crypto/rand` to generate 8 cryptographically random bytes
- Converts to hex string, producing a 16-character identifier (e.g., `4e74d42fd321ca91`)
- Generated once per request in `Messages()` handler (line 67)
- Stored in the `requests` table and used to correlate request/response data

---

## Streaming Chunks Processing

Streaming responses are handled in `handleStreamingResponse()` (handlers.go:299-480).

### Storage

Each SSE line (starting with `data:`) is appended to `streamingChunks []string` and stored in the database as JSON array.

### Deserialization

Yes, the JSON within each chunk IS deserialized. Two parsing passes occur:

1. **Generic parsing** (`map[string]interface{}`) - extracts metadata:
   - `message_start`: captures `id`, `model`, `stop_reason`
   - `message_delta`: captures usage data (input_tokens, output_tokens, cache tokens)

2. **Structured parsing** (`model.StreamingEvent`) - processes content:
   - `content_block_delta`: accumulates text deltas into `fullResponseText`
   - `content_block_start`: tracks tool use blocks
   - `message_stop`: signals end of stream

### Usage Information

The usage data in streaming chunks **IS the token usage for this request**. It's captured and recorded:

```go
// From message_delta event (lines 376-398)
if eventType == "message_delta" {
    if usage, ok := genericEvent["usage"].(map[string]interface{}); ok {
        finalUsage.InputTokens = int(usage["input_tokens"])
        finalUsage.OutputTokens = int(usage["output_tokens"])
        finalUsage.CacheCreationInputTokens = int(usage["cache_creation_input_tokens"])
        finalUsage.CacheReadInputTokens = int(usage["cache_read_input_tokens"])
    }
}
```

This usage is then:
1. Added to a reconstructed `responseBody` map (line 458)
2. Marshaled to JSON and stored in `responseLog.Body`
3. Saved to database via `UpdateRequestWithResponse()`

The usage endpoint (`/api/usage`) queries this stored data to display token costs.

---

## Conversation Building

The proxy has two separate data sources for displaying activity:

### 1. API Requests (SQLite Database)

All API calls intercepted by the proxy are stored in the `requests` table. This captures the raw request/response payloads, token counts, and routing decisions. The flow is documented above in "Database Writes".

### 2. Claude Code Conversations (Filesystem)

The proxy reads Claude Code's local conversation files directly from the filesystem.

**Location:** `~/.claude/projects/`

Each project directory contains `.jsonl` files (one per session). The `ConversationService` (`proxy/internal/service/conversation.go`) handles this:

1. **Discovery** (`GetConversations()`, line ~45): Walks `~/.claude/projects/`, finds all `.jsonl` files
2. **Parsing** (`parseConversationFile()`, line ~161): Reads each JSONL line as a `ConversationMessage`:
   ```go
   type ConversationMessage struct {
       ParentUUID  *string         // For conversation branching
       IsSidechain bool
       SessionID   string
       Type        string          // "user" or "assistant"
       Message     json.RawMessage // Flexible content format
       UUID        string
       Timestamp   string          // RFC3339
   }
   ```
3. **Aggregation**: Messages are sorted by timestamp and grouped into `Conversation` objects with metadata (start/end time, message count, project name)

**API Endpoint:** `GET /api/conversations` (handlers.go:663)
- Returns conversation summaries with first user message as preview (truncated to 200 chars)
- Sorted by last activity, paginated

**Detail Endpoint:** `GET /api/conversations/{id}?project={path}` (handlers.go:719)
- Returns full conversation with all messages

### Data Flow

```
Claude Code CLI
      ↓
~/.claude/projects/{project}/*.jsonl  ←──── ConversationService reads
      ↓
/api/conversations endpoint
      ↓
React components (ConversationThread.tsx, MessageFlow.tsx)

API Requests (via proxy)
      ↓
SQLite requests table  ←──── StorageService writes
      ↓
/api/requests endpoint
      ↓
React components (RequestDetailContent.tsx)
```

The web UI treats these as separate data sources - conversations show the Claude Code session history while requests show the raw API traffic.

### No Mapping Between Requests and Conversations

Requests are **not** correlated to conversations. The Anthropic API is stateless - each request contains the full conversation history in the `messages` array, but no session identifier.

- No session ID is sent in request headers or body
- The `RequestLog` struct has no conversation reference fields
- The frontend has dead code referencing `request.conversationId` and `request.turnNumber` (requests._index.tsx:293-297) but these are never populated

Potential correlation approaches (not implemented):
- Match by timestamp range (request timestamp falls within conversation start/end)
- Match by message content hashing (compare request messages to conversation messages)
- Match by working directory (if request body contained `cwd`, compare to conversation's project path)

---

## Data Format Comparison: JSONL vs Database

### Claude Code JSONL Files (`~/.claude/projects/*/*.jsonl`)

Each line is an independent JSON object representing a single event. Message types:

| Type | Description |
|------|-------------|
| `user` | User input message |
| `assistant` | Claude's response |
| `system` | System events (hooks, etc.) |
| `summary` | Conversation summary |
| `file-history-snapshot` | File state tracking |

**User message example:**
```json
{
  "parentUuid": null,
  "isSidechain": false,
  "userType": "external",
  "cwd": "/path/to/project",
  "sessionId": "ec1b7299-75f0-4031-8fa9-7edfcbdeebf5",
  "version": "2.0.74",
  "gitBranch": "main",
  "type": "user",
  "message": {
    "role": "user",
    "content": "How do I resume my session?"
  },
  "uuid": "d90580fe-1640-41b1-a259-61a694279bdd",
  "timestamp": "2025-12-20T05:28:47.527Z",
  "todos": []
}
```

**Assistant message example:**
```json
{
  "parentUuid": "d90580fe-1640-41b1-a259-61a694279bdd",
  "type": "assistant",
  "message": {
    "model": "claude-opus-4-5-20251101",
    "id": "msg_01H7YU3HiEp8PzctRp777w6x",
    "type": "message",
    "role": "assistant",
    "content": [
      {"type": "thinking", "thinking": "...", "signature": "..."},
      {"type": "tool_use", "id": "toolu_...", "name": "Task", "input": {...}}
    ],
    "stop_reason": "tool_use",
    "usage": {
      "input_tokens": 10,
      "cache_creation_input_tokens": 896,
      "cache_read_input_tokens": 18271,
      "output_tokens": 195
    }
  },
  "uuid": "ec2651ee-20a5-4236-94e8-6937f1c99ac7",
  "timestamp": "2025-12-20T05:28:58.449Z"
}
```

### Database Request Body (`requests.body`)

The full Anthropic API request format - contains **all accumulated messages** in a single call:

```json
{
  "model": "claude-opus-4-5-20251101",
  "messages": [
    {"role": "user", "content": [{"type": "text", "text": "..."}]},
    {"role": "assistant", "content": [{"type": "text", "text": "..."}, {"type": "tool_use", ...}]},
    {"role": "user", "content": [{"type": "tool_result", ...}]},
    ...
  ],
  "max_tokens": 21333,
  "temperature": 1,
  "system": [...],
  "tools": [...]
}
```

### Database Response (`requests.response`)

Wrapped Anthropic API response with proxy metadata:

```json
{
  "statusCode": 200,
  "headers": {...},
  "body": {
    "model": "claude-opus-4-5-20251101",
    "id": "msg_01GpzNbtwfWL6VxrjzsQ95fJ",
    "type": "message",
    "role": "assistant",
    "content": [
      {"type": "thinking", "thinking": "...", "signature": "..."},
      {"type": "tool_use", "id": "toolu_...", "name": "Read", "input": {...}}
    ],
    "stop_reason": "tool_use",
    "usage": {...}
  },
  "responseTime": 8443,
  "isStreaming": false,
  "completedAt": "2025-12-16T15:37:10-08:00"
}
```

### Key Differences

| Aspect | JSONL (Filesystem) | Database (requests table) |
|--------|-------------------|---------------------------|
| **Granularity** | One message per line | All messages accumulated per API call |
| **Metadata** | Claude Code specific: `uuid`, `parentUuid`, `sessionId`, `cwd`, `gitBranch`, `todos` | Proxy specific: `statusCode`, `responseTime`, `isStreaming` |
| **Message format** | `message` field contains role+content | `messages` array with full history |
| **Context** | Individual turns | Full conversation context sent each request |
| **Tool results** | Stored as separate `user` messages with `tool_result` | Inline in `messages` array |

### Similarities

- **Assistant content structure**: Both use the same Anthropic content block format:
  - `{"type": "text", "text": "..."}`
  - `{"type": "thinking", "thinking": "...", "signature": "..."}`
  - `{"type": "tool_use", "id": "...", "name": "...", "input": {...}}`
- **Usage data**: Both contain token counts in the same format (`input_tokens`, `output_tokens`, `cache_*`)
- **Model and message IDs**: Response body `id` (e.g., `msg_01...`) and `model` are identical
