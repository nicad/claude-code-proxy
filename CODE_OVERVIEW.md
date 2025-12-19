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
