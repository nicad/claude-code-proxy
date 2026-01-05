# Turns UI

# Overview

New "Turns" tab displaying requests mapped to their context using requests_context_summary, messages, and
message_content tables.

Scope (Phase 1):
- Landing page with summary table
- Message hover popup functionality
- Date-based pagination

Deferred:
- Request details page
- Clicking message links to show all requests


# Backend Changes

## 1. New API Endpoint: GET /api/turns

File: proxy/internal/handler/handlers.go

Query params:
- start - Start timestamp (RFC3339)
- end - End timestamp (RFC3339)
- sortBy - Column name (default: timestamp)
- sortOrder - ASC/DESC (default: DESC)

SQL Query (single statement with all joins):
```sql
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
   mc.role as response_role,
   mc.signature as response_signature,
   COALESCE(u.input_tokens, 0) + COALESCE(u.output_tokens, 0) +
       COALESCE(u.cache_creation_input_tokens, 0) as total_tokens,
   COALESCE(u.cache_read_input_tokens, 0) as cache_reads
FROM requests_context_summary rcs
JOIN requests r ON rcs.id = r.id
LEFT JOIN message_content mc ON rcs.last_message_id = mc.id
LEFT JOIN usage u ON rcs.id = u.id
WHERE datetime(rcs.timestamp) >= datetime(?)
 AND datetime(rcs.timestamp) <= datetime(?)
ORDER BY rcs.timestamp DESC
```

Response:
  {
   "turns": [
     {
       "id": "abc123",
       "timestamp": "2026-01-02T11:30:30+01:00",
       "model": "claude-opus-4-5-20251101",
       "context": "4578,4579,4580,...",
       "contextDisplay": "4578,4579,..[128]..,4960,4961,4962,4963",
       "messageCount": 133,
       "lastMessageId": 4963,
       "responseRole": "assistant",
       "responseSignature": "thinking,text,tool_use",
       "streaming": true,
       "totalTokens": 1978,
       "cacheReads": 114023
     }
   ],
   "total": 150,
   "oldest": "2026-01-01T00:00:00+01:00",
   "newest": "2026-01-02T12:00:00+01:00"
  }

## 2. New API Endpoint: GET /api/message-content/{id}

File: proxy/internal/handler/handlers.go

```sql
SQL Query:
SELECT id, role, signature, content, created_at
FROM message_content
WHERE id = ?
```

Response:
  {
   "id": 4578,
   "role": "user",
   "signature": "text",
   "content": {"role": "user", "content": [{"type": "text", "text": "..."}]},
   "createdAt": "2026-01-01T10:00:00Z"
  }

## 3. Storage Service Methods

File: proxy/internal/service/storage_sqlite.go

Add methods:
- `GetTurns(startTime, endTime, sortBy, sortOrder string) ([]TurnSummary, int, error)`
- `GetMessageContent(id int64) (*MessageContent, error)`

## 4. Route Registration

File: proxy/cmd/proxy/main.go

r.HandleFunc("/api/turns", h.GetTurns).Methods("GET")
r.HandleFunc("/api/message-content/{id}", h.GetMessageContent).Methods("GET")

# Frontend Changes

## 1. New Route: `web/app/routes/turns._index.tsx`

Pattern: Follow `tokens._index.tsx` structure

State:
  const [turns, setTurns] = useState<Turn[]>([]);
  const [total, setTotal] = useState(0);
  const [oldest, setOldest] = useState<string>("");
  const [newest, setNewest] = useState<string>("");
  const [dateRange, setDateRange] = useState<{start: string, end: string}>();
  const [sortBy, setSortBy] = useState("timestamp");
  const [sortOrder, setSortOrder] = useState<"ASC"|"DESC">("DESC");
  const [hoveredMessage, setHoveredMessage] = useState<{id: number, content: any} | null>(null);

Date Range Logic:
- Default: last 1 day from most recent request
- buttons to expand the time selection: 1 week, 1 month, all (all relative to the last request)
- Fetch latest date from /api/requests/latest-date on mount

Maybe later:
- control to choose span: 1 day (default), 1 week, 1 month, all
- control to choose start or end as a button '1 week ago', '1 month ago', 'first request'

## 2. API Proxy Route: web/app/routes/api.turns.tsx

export async function loader({ request }: LoaderFunctionArgs) {
 const url = new URL(request.url);
 const params = new URLSearchParams(url.search);
 const response = await fetch(`http://localhost:3001/api/turns?${params}`);
 return json(await response.json());
}

## 3. API Proxy Route: web/app/routes/api.message-content.$id.tsx

export async function loader({ params }: LoaderFunctionArgs) {
 const response = await fetch(`http://localhost:3001/api/message-content/${params.id}`);
 return json(await response.json());
}

## 4. Context Display Component

Render context as hoverable links:
  function ContextDisplay({ contextDisplay, context }: Props) {
   // Parse contextDisplay to extract message IDs
   // Render each ID as a hoverable span
   // On hover: fetch /api/message-content/{id} and show popup
  }

Popup component:
  function MessagePopup({ messageId, position }: Props) {
   const [content, setContent] = useState(null);

   useEffect(() => {
     fetch(`/api/message-content/${messageId}`)
       .then(r => r.json())
       .then(setContent);
   }, [messageId]);

   return (
     <div className="absolute z-50 bg-white shadow-lg rounded p-4 max-w-lg">
       <div className="text-xs text-gray-500">{content?.role}</div>
       <div className="text-xs text-gray-400">{content?.signature}</div>
       <div className="text-sm">{formatContent(content?.content)}</div>
     </div>
   );
  }

## 5. Add Tab to Navigation

File: `web/app/components/Layout.tsx`

Add "Turns" button after "Tokens" in tab navigation.

# Table Columns

| Column             | Source            | Width | Notes                         |
|--------------------|-------------------|-------|-------------------------------|
| Timestamp          | timestamp         | 160px | YYYY-MM-DD HH:MM:SS           |
| Model              | model             | 120px | Truncated model name          |
| Context            | contextDisplay    | flex  | Hoverable message IDs         |
| Last Id            | lastMessageId     | 80px  | Right-aligned                 |
| Msgs               | messageCount      | 60px  | Right-aligned                 |
| Stream             | streaming         | 60px  | yes/no                        |
| Response:role      | responseRole      | 80px  | user/assistant                |
| Response:signature | responseSignature | 150px | e.g. "thinking,text,tool_use" |
| InOutTokens        | totalTokens       | 100px | Right-aligned                 |
| CacheReads         | cacheReads        | 100px | Right-aligned                 |

Sortable columns: All columns clickable to sort

# Files to Create/Modify

| File                                       | Action                                          |
|--------------------------------------------|-------------------------------------------------|
| proxy/internal/handler/handlers.go         | Add GetTurns, GetMessageContent handlers        |
| proxy/internal/service/storage.go          | Add interface methods                           |
| proxy/internal/service/storage_sqlite.go   | Add GetTurns, GetMessageContent implementations |
| proxy/internal/model/models.go             | Add TurnSummary, MessageContent structs         |
| proxy/cmd/proxy/main.go                    | Register new routes                             |
| web/app/routes/turns._index.tsx            | NEW - Main turns page                           |
| web/app/routes/api.turns.tsx               | NEW - API proxy                                 |
| web/app/routes/api.message-content.$id.tsx | NEW - API proxy                                 |
| web/app/components/Layout.tsx              | Add Turns tab                                   |

# Implementation Order

1. Backend models - Add TurnSummary, MessageContent structs
2. Backend storage - Add GetTurns, GetMessageContent methods
3. Backend handlers - Add GetTurns, GetMessageContent handlers
4. Backend routes - Register /api/turns, /api/message-content/{id}
5. Frontend API routes - Add api.turns.tsx, api.message-content.$id.tsx
6. Frontend Layout - Add Turns tab to navigation
7. Frontend turns page - Create `turns._index.tsx` with table
8. Frontend hover - Add message popup on hover

