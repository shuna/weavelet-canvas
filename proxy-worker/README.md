# Weavelet Stream Proxy (Optional)

CloudFlare Worker that proxies SSE streams from LLM APIs with disconnect recovery.

**This is an optional component.** The main application works without it. Deploy this if you want server-side stream buffering to recover from client disconnections.

## Emergency suspension

`PROXY_SUSPENDED = "true"` in `wrangler.toml` suspends the proxy to stop Durable Objects operations. All requests except `/health` and OPTIONS return 503 before accessing storage or upstream APIs. Both Durable Object classes also reject requests and skip alarm cleanup without rescheduling. Existing data is retained; expiry cleanup is paused. `/health` reports `status: "suspended"`.

The public endpoint and preview URLs are also disabled with `workers_dev = false` and `preview_urls = false`, so browser requests to those URLs do not invoke the Worker. Browsers may continue attempting requests until the page is closed or polling is stopped.

Deploy with `npx wrangler deploy --config /absolute/path/to/proxy-worker/wrangler.toml`. Keep suspension enabled until the operation-limit cause is resolved. Resuming requires setting the variable to `"false"`, restoring the required public endpoint settings, and redeploying; alarms consumed during suspension are not automatically restored.

## Security considerations

**API key passthrough:** The client sends LLM API keys (e.g. `Authorization: Bearer sk-...`) inside the request body. The Worker forwards them verbatim to the LLM endpoint. Keys are **not** logged or stored, but they do transit through the Cloudflare Worker. If you are deploying this proxy for other users, make sure they understand this trust model. For production deployments, consider having the Worker inject API keys from Cloudflare secrets instead.

## How it works

1. Client sends LLM request to the Worker instead of directly to the LLM API
2. Worker forwards the request and streams SSE back with sequential event IDs
3. Worker buffers up to 1 MiB of chunks in memory during the stream
4. Streams, recovery, cancellation, ACK, and status are routed to one SQLite-backed Durable Object per session ID. Initial, periodic, disconnect, and terminal snapshots are committed to its storage (5 minute TTL). The most recent contiguous window is capped at 1 MiB. Recovery succeeds when the saved client cursor is within that window; a missing prefix returns an interrupted result.
5. If the client disconnects, the Worker reads for at most 20 seconds, then waits at most another 5 seconds for its final cache write.
6. Client reconnects and calls `/api/recover/:sessionId?lastEventId=N` to get missed chunks. The cursor must be a non-negative safe integer; missing prefixes and inconsistent terminal cursors return an interrupted result.
7. The Web app saves each bubble's stream status and request identity with the chat. Incomplete bubbles keep an inline recovery action after reload, scoped to that request. Recovery checkpoints expire seven days after creation; acknowledged records are cleaned up after one hour.

Changed snapshots are saved every 10 seconds throughout the stream, without a lifetime write-count limit. Terminal delivery waits up to five seconds for the serialized final cache write. Connected snapshots also cover loss of the final response before disconnect detection. Reconnects through another data center use the same stored snapshot. Unexpected runtime termination can lose events since the latest snapshot; recovery still rejects missing event ranges. Response bodies are deleted after five minutes or ACK. Metadata remains for 24 hours, with alarm-based cleanup. Existing Cache API sessions from older deployments cannot be migrated.

## Inspecting proxy state

Open **Settings → Proxy → プロキシの状態を確認**. The view fetches once when opened; subsequent refreshes require the **更新** button or an explicit action such as changing pages or looking up an ID. It lists stored records from all devices and runtimes in pages of twenty, comparing local recovery cursors where available. It shows the Worker version, Cloudflare data center, execution-instance identifier, relay phase, received/buffered bytes, cache-write failures, expiry, and classified termination reason. A session ID from another device can be entered manually.

The authenticated `GET /api/status?all=1` API enumerates the shared registry and reads metadata directly from each durable session, including requests this browser has never seen. It requires configured `PROXY_AUTH_TOKEN`. The response uses `scope: "all-sessions"`, `nextCursor`, and `unavailableSessions`; repeat with `cursor` to browse further pages. It never returns prompt/response bodies or provider credentials. Expired/removed diagnostic records are omitted; a page can be empty while still exposing a cursor for later registry entries. Missing objects are distinct from temporarily unavailable lookups, which are counted and shown as errors.

Known-ID inspection remains available through `GET /api/status?sessionId=...` (up to twenty IDs), including open-proxy mode where IDs act as capability tokens. Each known ID resolves to its durable session independently of the caller's data center. Diagnostic receipt is persisted before contacting the provider; unavailable receipt storage returns 503 without starting generation. Retained IDs cannot be reused. The browser's local database is only used to attach recovery cursors and actions; it does not select or block global records.

The status reader reads compact stored metadata rather than downloading response bodies on each poll. Blocked client writes transition to disconnected after 15 seconds; the existing 20-second upstream-read and 25-second final-save deadlines still apply. Stream-end logs contain only a hashed session reference, counters and a classified reason.

## Deleting stored data

The status view offers individual deletion and **プロキシの全保存データを削除**. Confirmation names the scope: response snapshots and diagnostic history are removed and matching active relays are aborted. Local conversations/checkpoints remain. New saves or ACKs from an already-deleted relay cannot recreate its stored data.

- `DELETE /api/storage/:sessionId` removes that session's response and diagnostic storage, alarms, and in-memory diagnostic record.
- `DELETE /api/storage` requires configured `PROXY_AUTH_TOKEN` and valid bearer authentication. It removes data across devices, including sessions outside the browser's twenty-item status list. Sessions started after the server's initial cutoff are preserved.
- Bulk responses contain `{ deleted, failed, before, cursor }`. Continue with the returned `before` and `cursor` until `cursor` is null. A failed item stays indexed for retry; clients must report failures rather than claiming complete deletion.

The REGISTRY Durable Object indexes opaque session object IDs with bounded retention (48 hours from their last registration). Each call deletes at most twenty objects. Deploy the v2 migration with the Worker. Before upgrading an existing v0.4 deployment, wait for its retained records to expire or inspect their known IDs so they are registered; previously created objects cannot be enumerated through a Durable Object binding. No live session storage existed in this production deployment when the registry was introduced.

## Storage and execution limits

Recovery uses SQLite-backed Durable Objects, provisioned by the binding and migration in `wrangler.toml`. Storage, request, and execution charges/limits apply according to the Cloudflare account plan; periodic snapshot writes continue for the duration of a stream. Each object keeps at most the latest 1 MiB of raw upstream data plus bounded metadata. Stored JSON is split into bounded values and committed atomically. [Cloudflare storage limits](https://developers.cloudflare.com/durable-objects/platform/limits/).

## Setup

### 1. Prerequisites

- [CloudFlare account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

### 2. Install dependencies

```bash
cd proxy-worker
npm install
```

### 3. Set auth token (optional but recommended)

```bash
npx wrangler secret put PROXY_AUTH_TOKEN
# Enter a random token when prompted
```

If not set, the proxy accepts all requests (open mode).

### 4. Deploy

```bash
npx wrangler deploy
```

### 5. Auto-deploy via GitHub Actions

1. Set repository variable `WORKER_DEPLOY_ENABLED` to `true`
2. Add repository secret `CLOUDFLARE_API_TOKEN` (create at CloudFlare dashboard > API Tokens)
3. Pushes to `main` that change files in `proxy-worker/` will auto-deploy

## Local development

```bash
cd proxy-worker
npx wrangler dev
```

The Worker runs at `http://localhost:8787`.

Keep the `enable_request_signal` compatibility flag enabled so client disconnects
start the bounded recovery period even when the upstream is silent.

This Worker can also proxy safety checks via `POST /api/moderation`, which is
useful for browser clients that can call chat completions directly but hit CORS
restrictions on moderation endpoints.

## API

### `POST /api/stream`

Proxies a streaming request to the LLM API.

**Headers:**
- `Authorization: Bearer <PROXY_AUTH_TOKEN>` (if token is set)
- `Content-Type: application/json`

**Body:**
```json
{
  "endpoint": "https://api.openai.com/v1/chat/completions",
  "headers": {
    "Authorization": "Bearer sk-...",
    "Content-Type": "application/json"
  },
  "body": {
    "model": "gpt-4",
    "messages": [...],
    "stream": true
  },
  "sessionId": "unique-session-id"
}
```

**Response:** SSE stream with `id` fields:
```
id: 1
data: "data: {\"choices\":[...]}\n\n"

id: 2
data: "data: {\"choices\":[...]}\n\n"

event: done
data: {}
```

### `POST /api/moderation`

Proxies a moderation request to an OpenAI-compatible Moderation API endpoint.

**Headers:**
- `Authorization: Bearer <PROXY_AUTH_TOKEN>` (if token is set)
- `Content-Type: application/json`

**Body:**
```json
{
  "endpoint": "https://api.openai.com/v1/moderations",
  "apiKey": "sk-...",
  "input": "text to classify"
}
```

**Response:** The upstream moderation JSON with the original status code.

### `POST /api/ack/:sessionId`

Client confirms full receipt of the stream. Deletes response parts from the session's durable storage and records acknowledgement. A delayed snapshot cannot recreate the deleted response; diagnostic metadata remains for 24 hours.

**Response:** `{ "deleted": true }`

### `GET /api/recover/:sessionId?lastEventId=N`

Replays chunks after the given event ID. A missing/expired/acknowledged response returns a cache miss immediately; a still-streaming entry is polled for at most 25 seconds. Requests from every data center route to the same durable session.

**Response:** SSE stream of missed chunks, same format as `/api/stream`.

### `GET /health`

Returns `{ "status": "ok", "version": "0.6.0" }`. No auth required.
