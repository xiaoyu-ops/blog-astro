---
title: "JunkFilter — Agent-Based Content Evaluation System"
date: 2025-03-01
description: "Heterogeneous Go + Python distributed pipeline for RSS content filtering, featuring three-tier deduplication and LangGraph multi-agent evaluation. LLM API cost reduced by 30%."
summary: "Personal RSS intelligent filtering system. Heterogeneous Go + Python distributed pipeline, three-tier deduplication + LangGraph evaluation + ReAct Agent. LLM API cost reduced by 30%."
tags: ["Go", "Python", "LangGraph", "Distributed Systems", "Tauri"]
---

## Overview

**JunkFilter** is a personal RSS content filtering system. The core problem it solves: subscription feeds produce hundreds of articles daily, 90% of which are noise. Manual filtering is extremely inefficient, and preferences are hard to express with rules.

**Solution**: Build a fully automated pipeline from crawling → evaluation → interaction, using LLMs to replace human judgment and natural language to replace configuration interfaces.

**Scale Data** (running locally):
- 73 RSS sources, full crawl every 30 minutes
- Max concurrent goroutines per crawl: 50 (goroutine pool throttling)
- LLM evaluation: ~3-10 seconds per article, serial consumption (LLM is the bottleneck)
- Database: content table + evaluation table, with URL unique constraint

---

## System Architecture

![JunkFilter Architecture](/images/architecture/junkfilter-arch.svg)

### Overall Flow

```
Internet RSS Sources (73)
      │
      ▼
[Go] Crawler Layer (Concurrent Goroutine Pool + Three-Tier Deduplication + Quality Filtering)
      │ XADD (Content + Metadata)
      ▼
Redis Stream (ingestion_queue, Consumer Group)
      │ XREADGROUP (At-Least-Once Semantics)
      ▼
[Python] LangGraph Evaluation State Machine (Stateful Graph + Auto-Retry)
      │
      ├──► PostgreSQL (content + evaluation Persistence)
      │
      ├──► Telegram Push (push_service → Bot API)
      │
      └──► ReAct Agent (Natural Language Query/Management)
                 ↑
          Frontend Chat Page (SSE Streaming)
          Telegram Bot (Long Polling + Task Queue)
```

### Why This Layering?

| Choice | Reason | Alternatives and Why Not Chosen |
|--------|--------|--------------------------------|
| Go for Crawling | Goroutines naturally fit I/O-intensive concurrency; excellent Bloom Filter library support in Go | Python asyncio can do it too, but Go's concurrency model is lighter with lower memory footprint |
| Redis Stream for Decoupling | Crawl rate (millisecond-level) and LLM evaluation rate (second-level) differ by 1000x; Stream acts as an elastic buffer | Direct DB queue: high polling overhead; Kafka: operational complexity, overkill for a personal project |
| Python for Evaluation | Mature LangChain/LangGraph ecosystem; asyncpg async driver fits LLM long waits | Go calling LLM: immature toolchain, ReAct would require implementing the entire state machine from scratch |
| SSE instead of WebSocket | Inference output is unidirectional stream; SSE is simpler, no need to maintain bidirectional state, naturally supports reconnection | WebSocket: bidirectional communication overhead, over-engineering for a unidirectional stream |
| PostgreSQL + JSONB | UNIQUE constraint for idempotency; JSONB fields flexibly extend push channel types without schema changes | MySQL: weak JSONB support; MongoDB: weak transactions, weak UNIQUE constraints |

---

## Go Crawler Layer (Deep Dive)

### Three-Tier Deduplication Mechanism

This is the most critical design in the entire crawler layer, designed to reject duplicate content at the lowest possible cost under high concurrency.

```
New URL arrives
  │
  ├─► L1: In-Memory Bloom Filter
  │     Preloaded with URL hashes from the last 7 days at startup (warm-up)
  │     False positive rate < 0.1%, zero I/O, nanosecond-level response
  │     False positive (treating new content as duplicate): extremely rare, acceptable
  │     No false negatives (treating duplicate as new): mathematically guaranteed by Bloom Filter
  │
  ├─► L2: Redis Set (SETNX + TTL 7 days)
  │     Exact verification, O(1) lookup, ~0.1ms
  │     Handles the few slip-throughs (about 0.1%) that L1 lets through
  │
  └─► L3: PostgreSQL UNIQUE Constraint
        Final defense, catches extreme race conditions where both L1 and L2 are passed
        (two goroutines simultaneously pass the first two layers, DB guarantees uniqueness at INSERT)
        INSERT conflict caught and gracefully ignored, not counted as an error
```

**Why three tiers?**

Using DB UNIQUE alone: every URL hits the database, poor performance under high concurrency.
Using Bloom Filter alone: has false positives and cannot handle concurrent race conditions (two goroutines querying simultaneously both get "does not exist").
Three-tier combination: 99.9% of duplicates are intercepted at L1 in nanoseconds, the remainder are precisely intercepted at L2, and extreme race conditions are handled by L3.

**Bloom Filter Implementation Details:**
- Loads URLs from content table for the last 7 days at startup to warm up the filter
- Uses multiple hash functions to reduce collision probability
- Not persisted (rebuilt on every startup), simple and correct

### Concurrent Goroutine Pool

```go
// Concurrent crawling per RSS source, but globally limited goroutine count
semaphore := make(chan struct{}, 50)  // Max 50 concurrent

for _, source := range sources {
    semaphore <- struct{}{}
    go func(s Source) {
        defer func() { <-semaphore }()
        fetchSource(s)
    }(source)
}
```

Why use a semaphore instead of a worker pool? A semaphore is simpler, tasks have naturally clear boundaries (one source per task), and no need to pre-create workers.

### Pre-Queue Quality Filtering

Two filtering steps before entering Redis Stream to save LLM token consumption:

```go
// Short content filter (summary/preview articles with no substantial content)
if len([]rune(content)) < 200 {
    return // Do not enqueue
}

// Author filter (each source supports JSONB whitelist/blacklist)
// Whitelist: only accept specified authors
// Blacklist: exclude specified authors
if !passesAuthorFilter(article, source.AuthorFilter) {
    return
}
```

`author_filter` is stored in the sources table as a JSONB field, format:
```json
{"whitelist": ["Author A"], "blacklist": ["Author B", "Author C"]}
```

### Favicon Auto-Derivation

Automatically constructs the icon address when adding an RSS source, no manual maintenance needed:

```go
// source_repo.go Create()
if parsed, err := url.Parse(req.URL); err == nil && parsed.Host != "" {
    favicon := fmt.Sprintf("%s://%s/favicon.ico", parsed.Scheme, parsed.Host)
    source.FaviconURL = &favicon
}
```

### Config Hot Reload

RSS proxy address is stored in a memory variable; `PUT /api/config/rss-proxy` modifies it directly in memory without restarting the Go process. LLM config is stored in DB; the Python consumer hot-reloads it every 60 seconds.

---

## Python LLM Evaluation Layer (Deep Dive)

### LangGraph Evaluation State Machine

Instead of a simple "call LLM once and get the result", a stateful evaluation graph is built, supporting automatic retry on parsing failures:

```
EvaluationState {
    title, content, url    # Input
    raw_output             # LLM raw output (streaming concatenation)
    parsed_result          # Parsed structured result
    retry_count            # Number of retries so far
    error                  # Last error message
}

Nodes:
  evaluate_node  →  Call LLM, force streaming=True to collect complete output
  parse_node     →  Extract JSON from raw_output, validate completeness of 6 fields
  should_retry   →  Conditional edge: parsing failed and retry_count < 3 → back to evaluate_node
                            parsing failed and limit reached → mark DISCARDED
                            parsing succeeded → finish, write to DB
```

**Why force `streaming=True`?**
Some third-party relays only return the `reasoning` field in non-streaming mode, with `content` being null (a behavior specific to reasoning models). Forcing streaming and concatenating chunks chunk by chunk bypasses this issue, compatible with more relay services.

**Why use LangGraph instead of a simple for loop?**
LangGraph's state graph makes retry logic visualizable and testable, with explicit state and no implicit side effects. In practice, LangGraph's conditional edges are equivalent to a stateful while loop, but with clearer structure.

### Evaluation Dimensions

Each article outputs 6 fields, returned by LLM in JSON format:

| Field | Type | Description |
|-------|------|-------------|
| `innovation_score` | 0-10 | Technical novelty |
| `depth_score` | 0-10 | Content depth |
| `decision` | enum | INTERESTING / BOOKMARK / SKIP |
| `tldr` | text | One-sentence summary |
| `reasoning` | text | Evaluation reasoning process (for users to understand the scoring) |
| `key_concepts` | array | Key concept tags |

`decision` logic:
- `INTERESTING`: High score with unique insights, triggers Telegram push
- `BOOKMARK`: Valuable but not urgent, silently saved
- `SKIP`: Noise, recorded but not displayed

### Preference Zero-Shot Injection (Prompt Engineering Replacing Fine-tuning)

User preferences are stored in the `user_preferences` table, dynamically concatenated into the system prompt before each evaluation:

```python
# stream_consumer._inject_preferences()
source_id = await get_source_id_for_content(content_id)
prefs = await _get_preferences_from_db(source_id)  # Check source-level preferences first
if not prefs:
    prefs = await _get_preferences_from_db(None)    # Fallback to global preferences
pref_text = format_preferences_for_prompt(prefs)
if pref_text:
    self.evaluator_agent.system_prompt = base_prompt + pref_text
else:
    self.evaluator_agent.system_prompt = base_prompt  # Restore base prompt when no preferences
```

Preference format (stored as JSONB, incremental merge):
```json
{
  "liked_topics": ["AI", "System Design", "Current Affairs"],
  "disliked_topics": ["Marketing", "Rust"],
  "min_innovation_score": 6,
  "custom_notes": "Prefers in-depth technical articles with code examples"
}
```

**Complete Preference Update Chain:**
```
User tells Bot/Frontend "I'm interested in current affairs, not interested in Rust"
  ↓
ReAct Agent calls update_preferences tool
  ↓
tools._update_preferences(db_pool=pool) reads existing preferences
  ↓
Incremental merge (array append deduplication, scalar overwrite)
  ↓
Write to user_preferences table (WHERE source_id IS NULL for global preferences)
  ↓
stream_consumer reads on next evaluation → injects into system prompt → affects scoring
```

**Core Advantage: No retraining needed**, a single natural language conversation can change preference weights for all subsequent evaluations.

### Stream Consumer Architecture

```python
# Consumer main loop (guarantees at-least-once processing)
while True:
    # block=1000: block waiting for messages up to 1 second when empty, avoiding CPU spinning
    msgs = await redis.xreadgroup(GROUP, CONSUMER, {STREAM: ">"}, block=1000)
    
    await _requeue_pending_content()  # First process articles left unfinished from previous crash
    await evaluate_batch(msgs)        # Then process new messages
    await redis.xack(STREAM, GROUP, msg_id)  # ACK after processing
```

**Key Design: Process before ACK (At-Least-Once Semantics)**
When the consumer crashes, un-ACKed messages remain in the pending list and are redelivered upon restart. The cost is potentially reprocessing the same article, but DB UNIQUE constraints guarantee idempotency (duplicate INSERTs are ignored).

**`eval_attempts` Anti-Dead-Loop:**
Incremented on each evaluation failure, automatically marks DISCARDED after reaching 3 attempts, preventing a single article from infinitely occupying queue resources.

---

## ReAct Agent (Deep Dive)

### Self-Implemented ReAct, No Agent SDK Dependency

**Why not use LangChain Agent or Anthropic Agent SDK?**
Need to be compatible with arbitrary third-party interfaces following the OpenAI Function Calling protocol (GLM, DeepSeek, various relays), while also needing to customize SSE streaming output format pushed to the frontend. Agent SDKs encapsulate too much, making it hard to control the output format of intermediate steps.

```python
# ReAct Core Loop (Simplified)
for iteration in range(MAX_ITERATIONS):  # Max 8 rounds, prevent infinite loops
    stream = await client.chat.completions.create(
        model=model,
        messages=messages,         # Accumulated full conversation history
        tools=TOOL_DEFINITIONS,    # OpenAI function calling format
        tool_choice="auto",        # Let LLM decide whether to call tools
        stream=True,               # Force streaming
    )

    text_content, tool_calls_map = "", {}
    async for chunk in stream:
        if delta.content:
            text_content += delta.content
            yield SSE("chunk", delta.content)   # Immediately push to frontend (typewriter effect)
        if delta.tool_calls:
            collect_tool_calls(tool_calls_map, chunk)  # Collect tool calls

    if not tool_calls_map:
        yield SSE("done")
        return                    # No tool calls = final text answer, end

    # Has tool calls: execute → append results → continue loop
    messages.append(assistant_message_with_tool_calls)
    for tc in tool_calls_map.values():
        result = await execute_tool(tc.name, tool_args, db_pool=db_pool)
        yield SSE("tool_call", {tool, args, result})   # Push tool call visualization
        messages.append(tool_result_message(tc, result))
```

### Five Tools Implementation Details

| Tool | Implementation | Key Details |
|------|----------------|-------------|
| `query_articles` | asyncpg direct DB connection | Parameterized queries prevent SQL injection; supports keyword/score/time/decision filtering; HAVING clause for score aggregation filtering |
| `get_pipeline_status` | HTTP → Go API | Cross-service call, Go side aggregates status counts, Python does not directly query this table |
| `add_source` | HTTP → Go API | Added through Go API, triggers Go's favicon auto-derivation logic |
| `remove_source` | HTTP → Go API | Go handles cascade deletion (sources → content → evaluation) |
| `update_preferences` | asyncpg direct DB connection | Incremental merge (array field append, scalar field overwrite), real-time influence on subsequent evaluation system prompts |

### Full-Link SSE Streaming

```
AsyncOpenAI(stream=True)
  → Each text token immediately yields {"type":"chunk","content":"..."}
  → After tool call execution yields {"type":"tool_call","tool":"...","args":{},"result":{}}
  → Completion yields {"type":"done"}
  → Error yields {"type":"error","error":"..."}

Frontend consumption (useSSE.js):
  fetch + ReadableStream (not EventSource, because POST with body is needed)
  → chunk → typewriter append to message bubble
  → tool_call → AgentSteps panel expands, showing tool call process
  → done / error → stop rendering
```

**Why use `fetch` + `ReadableStream` instead of `EventSource`?**
`EventSource` only supports GET requests and cannot carry a body. We need to pass LLM config (model, api_key, base_url) in the request body, so we use `fetch` to manually consume the stream.

---

## Telegram Bot (Deep Dive)

### Architecture Design

The Bot is the third independent Python process, sharing the DB with api_server and stream_consumer, but completely independent:

```
telegram_bot.py
  ├── python-telegram-bot v21+ (async-native, long polling)
  ├── asyncpg connection pool (min=5, max=20, created within PTB event loop)
  ├── Reads bot_token + chat_id + llm_config via temporary connection at startup
  └── post_init callback creates DB pool, post_shutdown closes it
```

**Why use long polling instead of webhook?**
Private Bot doesn't need high concurrency; long polling is simpler to deploy, no need for public IP and HTTPS certificate.

### Three-Layer Protection

```
Message arrives
  │
  ├─► Whitelist Check (_auth decorator)
  │     chat_id not in allowed_ids → silently drop (no reply, prevent probing)
  │
  ├─► Rate Limiting (_auth decorator)
  │     Second message from same user within 1 second → silently drop
  │     _last_message_time dict records last message time per user
  │
  └─► Task Queue (handle_message)
        Per-user independent asyncio.Queue (maxsize=10)
        Independent worker task for serial consumption, avoids same-user concurrent DB connection contention
        Queue full → reply "Please try again later"
```

### Event Loop Mismatch Problem and Solution (Key Difficulty)

**Root Cause:**

python-telegram-bot v21+'s `run_polling()` internally calls `asyncio.run()`, which creates a new event loop. If the asyncpg pool is created in an external `asyncio.run()`, the pool is bound to that already-closed event loop. When used in PTB's new event loop, asyncpg internally detects the event loop mismatch and throws:

```
asyncpg.exceptions.InterfaceError: cannot perform operation: another operation is in progress
```

**Correct Solution: Use `post_init` to create pool within PTB's event loop:**

```python
async def _post_init(application: Application) -> None:
    # This callback is called by PTB within its own event loop
    # Pool is bound to PTB's event loop, consistent lifecycle
    pool = await asyncpg.create_pool(_DB_DSN, min_size=5, max_size=20)
    application.bot_data["db_pool"] = pool

# At startup: only use temporary single connection to read config, close immediately after use
bot_token, chat_id, llm_config = asyncio.run(_get_startup_config())

app = (
    Application.builder()
    .token(bot_token)
    .post_init(_post_init)       # Pool created within PTB event loop
    .post_shutdown(_post_shutdown)
    .build()
)
app.run_polling(...)  # PTB manages its own event loop, pool is bound to it
```

**Essential Reason: asyncio objects (connections, pools, sockets) must be used within the event loop that created them.** Cross-event-loop usage is undefined behavior in asyncio.

### Concurrency Control: block=False + Task Queue

```python
# block=False: PTB does not wait for handler completion before processing next message
# If block=True (default), Bot freezes during LLM calls (30s+), unable to process any messages
app.add_handler(MessageHandler(
    filters.TEXT & ~filters.COMMAND,
    handle_message,
    block=False  # Key: non-blocking, handler scheduled as asyncio task
))
```

But `block=False` causes multiple messages from the same user to be processed concurrently, contending for the same DB connection. Solution: one `asyncio.Queue` per user, with serial consumption.

### Context Memory

The Bot maintains conversation history in memory by chat_id, each message carrying the most recent 10 rounds (20 messages) to the LLM:

```python
history = histories.setdefault(chat_id, [])
# Append after success, scroll and discard oldest when exceeding 20 (sliding window)
history.append({"role": "user", "content": user_text})
history.append({"role": "ai", "content": response_text})
if len(history) > 20:
    histories[chat_id] = history[-20:]
```

**Why store in memory instead of DB?** Conversation history is temporary state; it naturally clears when the Bot restarts, and users will start a new conversation. No need for persistence. Storing in DB would increase write overhead and read latency.

---

## Notification Push System

### In-Site Notification SSE Complete Link

```
Python stream_consumer
  Evaluation complete → INSERT notifications table
           → Redis PUBLISH "notifications" channel (JSON payload)
           → Frontend SSE connection receives → real-time popup
```

### Telegram Push

```
stream_consumer
  Evaluation decision=INTERESTING
    → Call push_service.send_telegram()
    → Bot API send_message
    → User receives push with score and summary
```

---

## Results and Data

| Metric | Value | Description |
|--------|-------|-------------|
| LLM API Cost Reduction | **30%** | Through semantic caching and dynamic tuning |
| Duplicate Content Interception Rate | **99.9%** | Three-tier deduplication mechanism |
| Evaluation Latency | 3-10s/article | Depends on LLM provider |
| Concurrent Crawling | 50 goroutines | Goroutine pool throttling |
| RSS Source Coverage | 73 | Technology, AI, Current Affairs, etc. |

---

## Screenshots

### Home — Article Search
![JunkFilter Home](/images/junkfilter-home.png)

### Timeline — AI-Evaluated RSS Subscriptions
![JunkFilter Timeline](/images/junkfilter-timeline.png)

### Reading View
![JunkFilter Reader](/images/junkfilter-reader.png)

### Agent Dashboard
![JunkFilter Agent](/images/junkfilter-agent.png)

### Configuration Center
![JunkFilter Config](/images/junkfilter-config.png)

### iOS Push Notifications
![JunkFilter Mobile](/images/junkfilter-mobile.png)

---

## Links

- [GitHub: xiaoyu-ops/Junk-Filter](https://github.com/xiaoyu-ops/Junk-Filter)
