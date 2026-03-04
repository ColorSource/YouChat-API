# YouChat Proxy (OpenAI/Anthropic Compatible)

A reverse proxy that routes requests to **you.com** and exposes OpenAI-compatible and Anthropic-compatible APIs.

This project runs a Playwright-based browser automation workflow behind the scenes (Chrome/Edge), manages multiple sessions, and forwards responses in streaming or non-streaming mode.

## Table of Contents
- [Features](#features)
- [How It Works](#how-it-works)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
- [Concurrency and Session Scheduling](#concurrency-and-session-scheduling)
- [Docker](#docker)
- [Troubleshooting](#troubleshooting)
- [Security Notes](#security-notes)
- [Disclaimer](#disclaimer)

## Features
- OpenAI-compatible API:
  - `GET /v1/models`
  - `POST /v1/chat/completions`
- Anthropic-compatible API:
  - `POST /v1/messages`
- Supports both streaming and non-streaming responses
- Session pool with lock-based scheduling
- Browser instance pool (configurable concurrency)
- Optional mode switching and request behavior tuning
- Optional proxy support (`http_proxy` / `https_proxy`)

## How It Works
1. The server accepts OpenAI/Anthropic-style requests.
2. A session and browser instance are selected by `SessionManager`.
3. The provider sends the request to you.com through Playwright browser automation.
4. Tokens are streamed back to the client using SSE (or returned once in non-stream mode).

## Requirements
- Node.js 20+
- One of the following browsers installed locally:
  - Google Chrome
  - Microsoft Edge
- A valid you.com account and session cookie

## Quick Start

### 1) Install dependencies
```bash
npm install
```

### 2) Configure session cookies
Copy `src/config/provider-config.example.mjs` to `src/config/provider-config.mjs`, then edit:
- `src/config/provider-config.mjs`

Example:
```javascript
export const config = {
    sessions: [
        {
            cookie: "paste-your-you-com-cookie-here"
        }
    ]
};
```

### 3) Configure environment variables
Use startup scripts as templates:
- Windows: `scripts/start.bat`
- Linux/macOS: `scripts/start.sh`

Set at least:
- `PASSWORD`
- `PORT`

### 4) Start server
Windows:
```bat
scripts\start.bat
```

Linux/macOS:
```bash
bash scripts/start.sh
```

Or directly:
```bash
node src/server/index.mjs
```

### 5) Run tests (optional)
```bash
npm test
```

## Configuration
Most runtime options are defined in startup scripts. Important ones:

- `PASSWORD`: API password used by both OpenAI/Anthropic auth middleware
- `PORT`: server port (default `8080`)
- `BROWSER_TYPE`: `auto` / `chrome` / `edge`
- `BROWSER_INSTANCE_COUNT`: number of browser workers (default currently `1`)
- `SESSION_LOCK_TIMEOUT`: auto-unlock timeout in seconds
- `USE_MANUAL_LOGIN`: enable manual login flow
- `AI_MODEL`: force a model globally
- `USE_CUSTOM_MODE`: enable custom chat mode
- `ENABLE_MODE_ROTATION`: rotate between modes
- `UPLOAD_FILE_FORMAT`: `txt` or `docx`
- `MAX_REQUEST_BODY_BYTES`: max request body size in bytes (default `1048576`)
- `ENABLE_LOCAL_MESSAGE_DUMP`: set `true` to dump formatted prompt files for debugging (default `false`)

Optional proxy environment variables:
- `http_proxy`
- `https_proxy`

## API Endpoints

### Authentication
If `PASSWORD` is set:
- OpenAI-compatible endpoints require:
  - `Authorization: Bearer <PASSWORD>`
- Anthropic-compatible endpoint requires:
  - `x-api-key: <PASSWORD>`

### `GET /v1/models`
Returns a model list in OpenAI format.

Example:
```bash
curl -H "Authorization: Bearer YOUR_PASSWORD" \
  http://127.0.0.1:8080/v1/models
```

### `POST /v1/chat/completions` (OpenAI-compatible)
Example (streaming):
```bash
curl -N http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_PASSWORD" \
  -d '{
    "model": "gpt-5",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Hello"}
    ]
  }'
```

### `POST /v1/messages` (Anthropic-compatible)
Example (streaming):
```bash
curl -N http://127.0.0.1:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_PASSWORD" \
  -d '{
    "model": "claude-sonnet-4-6",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Hello"}
    ]
  }'
```

### Streaming keep-alive
For streaming requests, the server sends SSE keep-alive heartbeats during slow upstream phases to reduce client-side idle disconnects.

## Concurrency and Session Scheduling
- Requests are accepted concurrently.
- Each request acquires:
  - one available session
  - one available browser instance
- If all sessions or browser instances are busy, the server returns saturation errors and the client should retry with backoff.

To increase throughput:
- Increase `BROWSER_INSTANCE_COUNT`
- Provide multiple valid sessions in `provider-config.mjs`

## Docker
Build image:
```bash
docker build . -t youchat-proxy
```

Run:
```bash
docker run --rm -p 8080:8080 youchat-proxy
```

## Troubleshooting

### "All sessions are saturated" / "Current load is saturated"
- Increase `BROWSER_INSTANCE_COUNT`
- Add more valid account sessions
- Reduce request burst

### Frequent disconnects on client side
- Use `stream: true`
- Ensure your client supports SSE streaming
- Increase client read timeout

### Authentication errors
- Verify header format and `PASSWORD` value
- OpenAI route uses `Authorization: Bearer ...`
- Anthropic route uses `x-api-key: ...`

### Browser not found
Install Chrome or Edge and set `BROWSER_TYPE=auto` (or explicitly set the browser type/path via your environment).

## Security Notes
- Never commit real cookies or tokens.
- Keep `src/config/provider-config.mjs` local/private.
- Use a strong `PASSWORD` in production.
- Consider running behind a private network or reverse proxy with additional access controls.

## Disclaimer
This project is for learning and research purposes only.
You are responsible for compliance with local laws, regulations, and third-party terms of service.
