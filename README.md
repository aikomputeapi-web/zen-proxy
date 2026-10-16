> **About this fork:** builds on upstream [12errh/zen-proxy](https://github.com/12errh/zen-proxy)
> and adds the **2026-10-16 free-tier fingerprint patch**. Fork-specific documentation is the
> first section below; the upstream README follows for reference.

# zen-proxy — opencode Zen free-tier proxy (fork with 2026-10-16 fingerprint fix)

A zero-dependency local proxy that unlocks opencode's Zen anonymous free models for any
coding agent, over both the OpenAI and Anthropic APIs (Claude Code included). Based on
[12errh/zen-proxy](https://github.com/12errh/zen-proxy) (MIT).

This fork exists because **upstream still 403s every free model under the latest
OpenCode gate** unless all three layers below are satisfied. Upstream ships layer 1;
this fork adds layers 2 and 3, measured live against `opencode.ai/zen/v1` on
2026-10-16 with an ablation matrix: any missing piece â†’ `403 FreeTierError` on
every `-free` model.

## The 2026-10 free-tier gate (3 layers)

### Layer 1 â€” session ID shape (2026-10-11, upstream already has this)

`x-opencode-session` must look like a real CLI session ID: `ses_` + 26 chars where the
leading 12 hex encode the REVERSED timestamp `~(ts_ms*0x1000 + counter) & 0xFFFFFFFFFFFF`
(see `packages/schema/src/identifier.ts` in anomalyco/opencode). Random IDs are rejected.
Upstream's latest main already mints these.

### Layer 2 â€” agent-shaped body (2026-09-18, added by this fork)

The request body must carry OpenCode's core agent tools â€” exact lowercase names
`bash`, `glob`, `grep`, `read` in chat `function` shape â€” and `stream: true` with
`stream_options.include_usage: true`.

Gotcha we hit and fixed: the gate matches the names **case-sensitively**. Claude Code
sends `Bash`/`Read` in PascalCase, which does NOT satisfy the gate, so the lowercase
stubs must always be appended after the client's own tools.

### Layer 3 â€” client-identity headers (2026-10-14, added by this fork)

The real CLI (v2.0.29+, packet-captured) sends a *pair plus echoes* of the session:
`x-opencode-session`, `x-session-id`, `x-session-affinity`, `x-opencode-session-id`
(all the same value), plus `x-opencode-client: cli` and `x-opencode-project: global`.
Requests are attributed to `User-Agent: opencode/latest/<version>/cli` â€” the 2.x CLI
package (`@opencode/cli` on npm), not the 1.x `opencode-ai` installer shim. This fork's
auto-UA now tracks `@opencode/cli`.

## What this fork changes vs upstream main

| Area | Upstream main | This fork |
|---|---|---|
| Session IDs | descending-timestamp `ses_` âœ“ | same (kept) |
| Tool stubs + forced streaming | âœ— | `applyFreeTierFingerprint()` â€” injects missing `bash/glob/grep/read`, forces `stream:true` + usage |
| JSON clients | forced stream would leak SSE | `aggregateChatStream()` â€” the forced SSE is stitched back into a normal `chat.completion` JSON (content, reasoning, tool_calls, usage); parser chosen by response content-type, so mocked/JSON-answering upstreams also work |
| Health probes & dashboard test | bare ping â†’ 403 â†’ every model mis-labelled dead | probes carry the full fingerprint and aggregate their streamed ping |
| User-Agent | `opencode/<v>` from `opencode-ai` (1.x shim) | `opencode/latest/<v>/cli` from `@opencode/cli`, auto-refreshed |
| Session headers | pair only (`x-opencode-session` + `x-opencode-session-id`) | full 2.0.29+ four-header set + client/project identity |

Nothing else changes: same config surface, same endpoints (`/v1/chat/completions`,
`/v1/messages`, `/v1/responses`), same install flow. Falls through to the next
candidate model when one is unavailable and keeps the deterministic model order.

## Tests

```bash
node --test            # runs the upstream suite + test/fingerprint.test.mjs
node --test test/fingerprint.test.mjs   # just the fingerprint layer (10 tests)
```

The fingerprint suite covers: stub injection (bare + tool-bearing clients), the
PascalCase-vs-lowercase gate, stream flip semantics, paid-model passthrough, session-ID
timestamp window decoding (48-bit wrap aware), and end-to-end SSEâ†’JSON aggregation
including tool-call stitching and in-stream error surfacing.

Known pre-existing failures on Windows hosts: the 3 `install.sh config preservation`
tests expect a POSIX shell; they fail on the pristine upstream checkout too.

### Ablation evidence (2026-10-16, from a US VPS)

| Probe | Result |
|---|---|
| session only (upstream main shape) | 403 FreeTierError, all free models |
| session + forced stream, no tools | 403 |
| session + stub tools, JSON (no stream) | 403 |
| random-shaped session + stream + tools | 403 |
| **descending session + stream + tools** | **200 on every free model** |
| same fingerprint on `/inference/v1/*` (new V2 path) | 200 (path is drop-in swappable) |

## Deployment note

If you are upgrading from a version whose config still points at the legacy
`/zen/v1` base, upstream's config migration handles it. The fingerprint is
endpoint-agnostic, so if OpenCode moves the gate path again the fix is a one-line
`upstream` config change.

## License

MIT, same as upstream. All credit to [12errh](https://github.com/12errh) for the
excellent original; this fork only adds the layers OpenCode's gate grew since 2026-09.

---

# Upstream README (kept below)

See [12errh/zen-proxy](https://github.com/12errh/zen-proxy#readme) for the full upstream
documentation: configuration reference, Anthropic/Claude Code support, responses-API
translation, agent-tool bridging for Claude clients, and the admin dashboard.


<p align="center">
  <img src="assets/logo.png" width="110" alt="zen-proxy" />
</p>

<p align="center"><b>zen-proxy</b></p>
<p align="center">Use OpenCode Zen's free models from any AI coding agent â€” <b>OpenAI&nbsp;and&nbsp;Anthropic&nbsp;compatible</b> â€” no account, no API key.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-ccf73a?style=flat-square&labelColor=1a1612" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-8b8b8b?style=flat-square&labelColor=1a1612" alt="Node 18+">
  <img src="https://img.shields.io/badge/dependencies-0-8b8b8b?style=flat-square&labelColor=1a1612" alt="Zero dependencies">
  <img src="https://img.shields.io/badge/endpoint-OpenAI%20%2B%20Anthropic-8b8b8b?style=flat-square&labelColor=1a1612" alt="OpenAI and Anthropic compatible">
</p>

---

## What it is

OpenCode publishes free AI models (`space-bunny-free`, `mimo-v2.6-flash-free`, `big-pickle`, â€¦) â€” but their gateway only answers requests that come from the OpenCode CLI itself. Any other agent gets:

```
403 FreeTierError: OpenCode's free tier can only be used from within OpenCode
```

**zen-proxy** is a single-file local server that sits in front of that gateway and speaks for your agent. Point Cline, Roo, Continue, Aider, Claude Code, or anything else that accepts a `baseURL` at it, and you get those free models â€” still anonymously, still with no account and no API key.

It speaks **two wire formats**, so you're not locked into one SDK:

- **OpenAI** â€” `/v1/chat/completions`, `/v1/responses`, `/v1/models`. Cline, Roo Code, Continue, Aider, mimo, opencode forks, anything with a `baseURL`.
- **Anthropic** â€” `/v1/messages` and `/v1/messages/count_tokens`, including the full streaming envelope, tools, images and thinking blocks. **Claude Code works as-is**, including file and shell tools.

Everything runs on your machine. Nothing is sent anywhere but OpenCode's own API.

---

## How it works

The gateway accepts a request only when it carries the identity and shape of a real OpenCode session. Three things matter, all measured by replaying genuine requests upstream:

| Requirement | What zen-proxy does |
|---|---|
| A valid session identity â€” `x-opencode-session` **and** `x-opencode-session-id`, sharing one value | Mints a stable per-client ID and sends both headers |
| The ID must look real â€” its first 12 hex characters encode a creation time | Generates IDs in OpenCode's own format, not random hex |
| Served from `https://opencode.ai/inference/v1` | Uses that base, and migrates older configs that still point at the retired `/zen/v1` path |

One more rule applies specifically to `/v1/messages` (the Anthropic endpoint): the gateway requires OpenCode's own tool manifest to be present. Claude Code's system prompt is passed through **completely untouched** â€” but zen-proxy attaches a few of OpenCode's built-in tools alongside Claude Code's, and renames any resulting tool calls back to Claude Code's names and argument spelling. Details in [Claude Code](#claude-code).

> **Note on plain chat clients:** the gateway only answers genuine *agent* traffic â€” a request must stream, carry a system message, and include tool definitions. All the coding agents above do this, so they work as-is. A bare `curl` or a chat-only client that sends none of those gets `403 FreeTierError`; that is the gateway's rule, not a proxy fault.

---

## What it supports

| Capability | Status |
|---|---|
| `POST /v1/chat/completions` â€” streaming and non-streaming | âœ… |
| `POST /v1/responses` (Responses API) | âœ… translated both ways |
| `POST /v1/messages` â€” Anthropic Messages API, for Claude Code | âœ… full streaming envelope, tools, images, thinking |
| `POST /v1/messages/count_tokens` | âœ… |
| `GET /v1/models` | âœ… |
| Automatic fallback across free models on `429`/`5xx`/unavailable | âœ… honors `retry-after` |
| Model aliases â€” call it `gpt-4o`, get a free model back | âœ… |
| Anonymous `Bearer public` **or** your own Zen key (BYOK) | âœ… |
| Free-model catalog kept current by a GitHub Action | âœ… [`models.json`](models.json), every 6 h |
| Management dashboard | âœ… `http://127.0.0.1:8787/` |
| Per-IP rate limiting, `proxyKey` lock | âœ… opt-in |

---

## Install

Requires **Node.js 18 or newer**. No `npm install` â€” there are no dependencies.

**Linux / macOS**

```bash
curl -fsSL https://raw.githubusercontent.com/12errh/zen-proxy/main/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/12errh/zen-proxy/main/install.ps1 | iex
```

**Or from source**

```bash
git clone https://github.com/12errh/zen-proxy.git
cd zen-proxy
node zen-proxy.mjs
```

The proxy listens on `http://127.0.0.1:8787` and prints its URLs on startup.

---

## Setup

### Any OpenAI-compatible agent (Cline, Roo, Continue, Aider, mimo, opencode)

Set the base URL to `http://127.0.0.1:8787/v1` and the API key to `public`. That's the whole configuration.

**opencode** â€” in `opencode.json`:

```jsonc
{
  "provider": {
    "zen": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://127.0.0.1:8787/v1" },
      "models": { "space-bunny-free": { "name": "Space Bunny Free" } }
    }
  },
  "model": "zen/space-bunny-free"
}
```

**Cline / Roo Code / Continue / Aider / mimo** â€” any provider form that takes a `baseURL` + `apiKey`:

```jsonc
{
  "provider": {
    "zen": {
      "baseURL": "http://127.0.0.1:8787/v1",
      "apiKey": "public",
      "models": { "space-bunny-free": {} }
    }
  }
}
```

Which models are available right now:

```bash
curl -s http://127.0.0.1:8787/v1/models -H "Authorization: Bearer public"
```

### Claude Code

Claude Code speaks the Anthropic Messages API, which zen-proxy implements directly:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
export ANTHROPIC_AUTH_TOKEN=public     # any value; it falls back to the anonymous tier
claude
```

Then, inside Claude Code:

```
/model space-bunny-free
```

Two things worth knowing:

- **Claude Code warns the model is outside its catalog** and assumes a 200k context window. Set `CLAUDE_CODE_MAX_CONTEXT_TOKENS` to the free model's real limit to avoid premature auto-compact.
- **Why OpenCode's tools get attached.** With only Claude Code's own tools the gateway returns `403` â€” measured, not assumed. zen-proxy therefore adds a handful of OpenCode's built-in tools alongside Claude Code's, **only those Claude Code has a counterpart for**, and translates calls back:

  | Attached as | You get back | Arguments |
  |---|---|---|
  | `read` | `Read` | `filePath` â†’ `file_path` |
  | `edit` | `Edit` | `filePath`, `oldString`, `newString` â†’ `file_path`, `old_string`, `new_string` |
  | `write` | `Write` | `filePath` â†’ `file_path` |
  | `bash` | `Bash` | `workdir` dropped (no counterpart) |
  | `grep`, `glob`, `list` | `Grep`, `Glob`, `LS` | passed through |

  A tool Claude Code doesn't offer is never attached, so the model can't request something that can't run. Set `agentTools: false` to turn this off.

### Verify it works

Check the server is up:

```bash
curl -s http://127.0.0.1:8787/health
# {"ok":true,"upstream":"https://opencode.ai/inference/v1"}
```

Then send a request shaped the way the gateway expects â€” **streaming**, with a system message and at least one tool:

```bash
curl -sN http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer public" \
  -d '{
    "model": "space-bunny-free",
    "stream": true,
    "max_tokens": 32,
    "system": "You are a coding assistant. Answer concisely.",
    "messages": [{"role": "user", "content": "say hi"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "read",
        "description": "Read a file from disk.",
        "parameters": {"type": "object", "properties": {"filePath": {"type": "string"}}}
      }
    }]
  }'
```

You should see `data:` lines streaming back. See [Things to know](#things-to-know) for why the shape matters.

---

## Configuration

Config lives in **`zen-proxy.json`**, created on first run, hot-reloaded when edited, and writable from the dashboard. Environment variables can override anything at startup.

| Key | Default | Description |
|---|---|---|
| `host` / `port` | `127.0.0.1` / `8787` | Bind address (restart required) |
| `upstream` | `https://opencode.ai/inference/v1` | Zen gateway base |
| `ua` / `autoUA` | `opencode/1.18.30` / `true` | User-Agent sent upstream; auto-tracks new OpenCode releases |
| `injectSession` | `true` | Mint and send the session header pair |
| `agentTools` | `true` | Attach OpenCode's tools to `/v1/messages` (see [Claude Code](#claude-code)) |
| `defaultModel` | `""` | Empty = auto-pick the first working free model |
| `fallbackModels` | *(from [`models.json`](models.json))* | Tried in order on `429`/`5xx`/unavailable. Omit it to follow the catalog; save it once to pin your own list |
| `modelAliases` | `{}` | e.g. `{"gpt-4o": "space-bunny-free"}`; the reply's model name is rewritten back |
| `responsesModels` | `["gpt-5*","gpt-6*","grok-*","muse-spark-*"]` | Models served on `/v1/responses`; patterns may end in `*` |
| `defaultZenKey` | `""` | Your own Zen key instead of anonymous `public` |
| `proxyKey` | `""` | If set, clients must send it; also locks the dashboard and `/api/*` |
| `rateLimitMax` / `rateLimitWindowMs` | `0` (off) / `60000` | Per-client rate limiting for inference routes |
| `timeoutMs` / `cacheMs` | `120000` / `30000` | Upstream timeout, `/v1/models` cache TTL |
| `autoSync` / `autoSyncIntervalMs` | `true` / `3600000` | Runtime discovery of newly-offered free models |
| `trustForwarded` | `false` | Honour `x-forwarded-for` when behind a reverse proxy |

**Environment variables:** `HOST`, `PORT`, `ZEN_URL`, `ZEN_UA`, `INJECT_SESSION=0`, `AUTO_UA=0`, `UA_REFRESH_MS`, `AGENT_TOOLS=0`, `PROBE_AUTH`, `DEFAULT_MODEL`, `FALLBACK_MODELS` (JSON), `MODEL_ALIASES` (JSON), `RESPONSES_MODELS` (JSON), `PROXY_KEY`, `ZEN_KEY`, `TRUST_FORWARDED=1`, `TIMEOUT_MS`, `CACHE_MS`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `AUTO_SYNC=0`, `AUTO_SYNC_MS`, `ZEN_PROXY_CONFIG`.

### Bring your own key

Anonymous `public` access shares a per-IP quota that is sometimes saturated. For steadier service set `defaultZenKey` to your own Zen key, or send it per request as `x-zen-key`.

---

## Dashboard

`http://127.0.0.1:8787/`

- **Overview** â€” upstream health, uptime, request counters, live request feed with status and latency
- **Models** â€” add or remove models, pick the default, test any model with one click
- **Settings** â€” edit and save config instantly; **Restore defaults** returns the model list to following [`models.json`](models.json)
- **Logs** â€” live log tail

![zen-proxy dashboard](assets/dashboard.png)

---

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions |
| `POST` | `/v1/responses` | OpenAI Responses API |
| `POST` | `/v1/messages` | Anthropic Messages API |
| `POST` | `/v1/messages/count_tokens` | Anthropic token estimate |
| `GET` | `/v1/models` | Available models |
| `GET` | `/health` | Health check (always open) |
| `GET` | `/` | Dashboard |
| `GET`/`PUT` | `/api/config` | Read / update configuration |
| `GET` | `/api/status` | Stats and upstream health |
| `POST` | `/api/test` | Test one model â€” `{"model":"..."}` |
| `GET` | `/api/logs` | Log tail |
| `POST` | `/api/sync` | Re-run model discovery |
| `POST` | `/api/reset` | Reset request statistics |

Setting `proxyKey` protects the dashboard and every `/api/*` route.

---

## Running as a service (Linux)

`install.sh` offers to install a systemd unit; or manually:

```bash
sudo systemctl enable --now zen-proxy
```

---

## Things to know

- **This rides an anonymous free tier.** Expect per-IP quotas and a shared pool that gets saturated. Don't run heavy workloads on it â€” bring a key if you need reliability.
- **The gateway expects agent-shaped traffic.** Streaming, a system message, and tool definitions are all required; without them you get `403 FreeTierError`. Every coding agent listed above sends them. If you build your own client, send them too.
- **A model showing "agent-only" is not broken.** The gateway refuses the built-in health probe because it isn't genuine agent traffic, so the proxy can't confirm those models up front. It learns real health from your actual requests instead â€” a model that serves you shows `ok (live traffic)`. Models are never removed on a temporary block.
- **Which models exist comes from OpenCode's public catalog**, not from probing: a retired model and a healthy one are refused identically, so probing can't tell them apart. A GitHub Action refreshes [`models.json`](models.json) every 6 hours.
- **When the proxy falls back**, the response carries `zen_served_by` plus `x-zen-served-by` and `x-zen-fallback` headers so you can see which model actually answered.
- **`agent-tools.json` is a capture of OpenCode's tools.** If OpenCode changes its tool schemas, the `/v1/messages` bridge may stop satisfying the gateway and Claude Code will start returning `403`. Regenerate it by capturing any OpenCode request.

---

<p align="center">MIT licensed. Runs entirely on your machine.</p>