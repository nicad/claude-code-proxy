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
