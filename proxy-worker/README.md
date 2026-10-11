# Weavelet Stream Proxy (Optional)

CloudFlare Worker that proxies SSE streams from LLM APIs with disconnect recovery.

**This is an optional component.** The main application works without it. Deploy this if you want server-side stream buffering to recover from client disconnections.

## Security considerations

**API key passthrough:** The client sends LLM API keys (e.g. `Authorization: Bearer sk-...`) inside the request body. The Worker forwards them verbatim to the LLM endpoint. Keys are **not** logged or stored, but they do transit through the Cloudflare Worker. If you are deploying this proxy for other users, make sure they understand this trust model. For production deployments, consider having the Worker inject API keys from Cloudflare secrets instead.

## How it works

1. Client sends LLM request to the Worker instead of directly to the LLM API
2. Worker forwards the request and streams SSE back with sequential event IDs
3. Worker buffers up to 1 MiB of chunks in memory during the stream
4. Disconnect snapshots use the Workers Cache API (5 minute best-effort TTL; entries are not shared between data centers). The saved prefix is capped at 1 MiB; a capacity-limited recovery ends as interrupted.
5. If the client disconnects, the Worker reads for at most 20 seconds, then waits at most another 5 seconds for its final cache write.
6. Client reconnects and calls `/api/recover/:sessionId?lastEventId=N` to get missed chunks

## Free plan limits

| Resource | Free tier | Impact |
|----------|-----------|--------|
| Requests | 100k/day | ~100k stream + recover calls |
| CPU time | 10ms/req | Network waits are excluded, but parsing and snapshot serialization consume CPU; measure production usage |
| Cache API | No KV write quota | Best-effort recovery only; eviction and a different data center can miss |

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

Client confirms full receipt of the stream. Deletes a local Cache API entry when present; `deleted: false` is normal for a cache miss or another data center.

**Response:** `{ "deleted": true }`

### `GET /api/recover/:sessionId?lastEventId=N`

Replays chunks after the given event ID. A local cache miss is returned immediately; a still-streaming local entry is polled for at most 25 seconds. Cache entries are best effort: expiry, eviction, or a different data center can make recovery unavailable.

**Response:** SSE stream of missed chunks, same format as `/api/stream`.

### `GET /health`

Returns `{ "status": "ok", "version": "0.2.0" }`. No auth required.
