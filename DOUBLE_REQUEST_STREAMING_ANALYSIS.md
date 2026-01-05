# Double Request Analysis: Streaming vs Non-Streaming

## Summary

Claude Code makes **two separate HTTP requests** for each user interaction:
1. A streaming request (`stream: true`)
2. A non-streaming request (`stream` omitted or false)

Both requests contain identical message content and occur within seconds of each other.

## Evidence

### Database Statistics

| Metric | Count |
|--------|-------|
| Total requests | 3365 |
| Streaming requests | 1546 |
| Non-streaming requests | 1577 |
| Duplicate pairs (same context, different stream flag) | 1822 |

Approximately **54% of all requests are duplicates**.

### Example Pair

Two requests logged 5 seconds apart with identical content:

| Field | Streaming Request | Non-Streaming Request |
|-------|-------------------|----------------------|
| ID | `5c8c41877288f3b3` | `b037f288b3436016` |
| Timestamp | 2025-12-27T00:02:25 | 2025-12-27T00:02:30 |
| `stream` param | `true` | (missing) |
| Message count | 363 | 363 |
| Body length | 579,449 bytes | 579,451 bytes |
| Context hash | identical | identical |
| Last message ID | 4525 | 4525 |
| Response status | 200 | 200 |
| Response `isStreaming` | true | false |

### Request Header Differences

Comparing the same example pair:

| Header | Streaming | Non-Streaming |
|--------|-----------|---------------|
| `Content-Length` | 585,169 | 585,171 |
| `X-Stainless-Helper-Method` | `stream` | (absent) |
| `X-Stainless-Timeout` | 600 | 600 |

All other headers are identical:
- `Anthropic-Beta`: `claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14`
- `Anthropic-Version`: `2023-06-01`
- `User-Agent`: `claude-cli/2.0.76 (external, cli)`
- `Sentry-Trace`: Same trace ID AND span ID for both requests

### Sentry Trace Analysis

The `Sentry-Trace` header format is `{trace_id}-{span_id}`.

**Finding**: Both trace ID and span ID are identical between paired requests:
- Example: `a4d6b5a8464a4e018c3353213e45b0f7-ad3bcbd88ab4eeb2`

Further investigation shows the Sentry-Trace is a **session identifier**, not a per-request identifier:

| Trace ID | Days Active | Request Count |
|----------|-------------|---------------|
| `a4d6b5a8464a4e018c3353213e45b0f7` | Dec 26, 28, 30 | 296 |
| `c5a22b24247f45998298264a04a39195` | Dec 25 | 201 |
| `ec5891f0318d483bbe908fbe88a7ffc5` | Dec 20, 22, 23, 24 | 660 |

All 296 requests sharing trace ID `a4d6b5a8...` also share the **same span ID** `ad3bcbd88ab4eeb2`.

**Conclusion**: The identical Sentry-Trace between streaming and non-streaming pairs confirms they originate from the same Claude Code session, but does NOT prove they're the "same request" since the trace/span never changes within a session

### Response Header Differences

| Header | Streaming | Non-Streaming |
|--------|-----------|---------------|
| `Content-Type` | `text/event-stream; charset=utf-8` | `application/json` |
| `Cache-Control` | `no-cache` | (absent) |
| `Request-Id` | `req_011CWW8cuuyiyrxmijmbKRgF` | `req_011CWW8dKnAzoDLKxc429zUe` |
| `X-Envoy-Upstream-Service-Time` | 3053 ms | 7050 ms |

Rate limit headers are nearly identical (minor utilization differences).

### Response Body Differences

| Field | Streaming | Non-Streaming |
|-------|-----------|---------------|
| Response time | 5,549 ms | 7,281 ms |
| Body length | 254 bytes | 929 bytes |
| Input tokens | 8 | 8 |
| Output tokens | 120 | 119 |
| `stop_reason` | (not captured) | `tool_use` |

**Note**: The streaming response body is a synthetic reconstruction from SSE chunks. The non-streaming response contains the complete API response.

### Token Variation Across Pairs

Comparing 10 recent duplicate pairs:

| Streaming Output | Non-Streaming Output | Difference |
|------------------|---------------------|------------|
| 255 | 196 | -59 |
| 43 | 46 | +3 |
| 26 | 26 | 0 |
| 1020 | 1059 | +39 |
| 187 | 124 | -63 |
| 113 | 113 | 0 |
| 142 | 101 | -41 |
| 32 | 32 | 0 |
| 562 | 728 | +166 |
| 32 | 36 | +4 |

Token counts sometimes differ between paired requests, suggesting they receive **different responses** from the API despite identical input.

### Average Response Times

| Type | Count | Avg Response Time |
|------|-------|-------------------|
| Streaming | 1,630 | 7,696 ms |
| Non-streaming | 1,661 | 7,296 ms |

Response times are comparable on average.

### Pattern Query

```sql
-- Find streaming/non-streaming pairs with same content
SELECT COUNT(*) as pair_count
FROM requests_context rc1
JOIN requests_context rc2
  ON rc1.context = rc2.context
  AND rc1.last_message_id = rc2.last_message_id
  AND rc1.id != rc2.id
  AND rc1.streaming = 1
  AND rc2.streaming = 0
  AND julianday(rc2.timestamp) - julianday(rc1.timestamp) < 0.0007  -- within ~1 minute
```

Result: **1822 pairs**

## Proxy Code Analysis

The proxy (`handlers.go`) does NOT create duplicate entries:

1. **Single save point**: `SaveRequest()` called once per HTTP request (line 93)
2. **Update, not insert**: `UpdateRequestWithResponse()` updates the existing record (lines 608/653)
3. **Unique request IDs**: Each HTTP request gets a unique ID via `generateRequestID()`

```go
// Line 93 - Only called once per HTTP request
if _, err := h.storageService.SaveRequest(requestLog); err != nil {
    log.Printf("❌ Error saving request: %v", err)
}

// Lines 124-130 - Mutually exclusive handlers
if req.Stream {
    h.handleStreamingResponse(w, resp, requestLog, startTime)
    return
}
h.handleNonStreamingResponse(w, resp, requestLog, startTime)
```

## Conclusion

The duplicate entries are **client behavior**, not a proxy bug. Claude Code intentionally sends two requests per interaction:

1. **Streaming request**: Provides real-time output to the user terminal
2. **Non-streaming request**: Likely used for conversation logging, caching, or validation

## Impact

- Token usage is doubled in reports (both requests consume API tokens)
- Request counts appear inflated
- Conversation reconstruction may see duplicate entries

## Potential Mitigations (not implemented)

1. **Filter duplicates in queries**: Exclude non-streaming requests that have a streaming counterpart
2. **Mark duplicates**: Add a `is_duplicate` flag during reindexing
3. **Deduplicate at storage**: Skip saving requests with identical context within a time window

Currently no mitigation is applied - both requests are logged as received.

## Related: stop_reason Behavior

### GitHub Issue #12303

[Issue #12303](https://github.com/anthropics/claude-code/issues/12303) describes a **different** duplicate response problem:

When Claude's response is too long, the API returns `stop_reason: null` (meaning "I have more to say"). Claude Code correctly requests a continuation, but renders **both responses as separate conversation turns** instead of combining them.

```
Response 1: stop_reason: null
  → Display message 1
  → Request continuation
Response 2: continuation
  → Display message 2 as NEW turn ❌ (should be combined with message 1)
```

### Comparison with Our Observation

| Aspect | Issue #12303 | Our Observation |
|--------|--------------|-----------------|
| Cause | Long response triggers continuation | Unknown client behavior |
| Request content | Different (continuation vs original) | Identical messages |
| `stream` param | Same for both | Different (true vs false/missing) |
| Timing | Sequential (response triggers next) | Near-simultaneous (~5 seconds) |
| `stop_reason` | First is `null`, second has value | Both have values |

### stop_reason Distribution in Our Data

| Type | stop_reason | Count |
|------|-------------|-------|
| Non-streaming | `tool_use` | 922 |
| Non-streaming | `end_turn` | 736 |
| Non-streaming | `max_tokens` | 26 |
| Non-streaming | null/missing | 4 |
| Streaming | (not captured) | 1,623 |

**Note**: Our streaming handler doesn't extract `stop_reason` from SSE events - it's only captured for non-streaming responses.

### stop_reason Values

| Value | Meaning |
|-------|---------|
| `end_turn` | Model finished naturally |
| `tool_use` | Model wants to call a tool |
| `max_tokens` | Hit output token limit |
| `null` | Model has more to say (triggers continuation) |

### Conclusion

Our duplicate request pattern (streaming + non-streaming with identical content) is **not related** to issue #12303. The continuation bug involves sequential requests with different content triggered by `stop_reason: null`, while our observation shows parallel requests with identical content but different `stream` parameters.
