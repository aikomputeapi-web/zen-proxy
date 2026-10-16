// Free-tier fingerprint unit tests (2026-10-16)
// Run: node --test test/fingerprint.test.mjs
// Covers the 2026-09-18 agent-shape gate (bash/glob/grep/read stubs + stream:true)
// layered on top of the 2026-10-11 descending-timestamp session-ID gate.
import { test, describe } from "node:test"
import assert from "node:assert/strict"

const zp = await import("../zen-proxy.mjs")
const { isFreeModel, applyFreeTierFingerprint, aggregateChatStream, sessionFor } = zp

describe("isFreeModel", () => {
  test("recognizes -free suffix and known unlabeled free models", () => {
    assert.equal(isFreeModel("mimo-v2.6-flash-free"), true)
    assert.equal(isFreeModel("big-pickle"), true)
    assert.equal(isFreeModel("space-bunny-free"), true)
  })
  test("rejects paid models", () => {
    assert.equal(isFreeModel("gpt-5.2"), false)
    assert.equal(isFreeModel("claude-opus-4-7"), false)
    assert.equal(isFreeModel(""), false)
    assert.equal(isFreeModel(undefined), false)
  })
})

describe("applyFreeTierFingerprint", () => {
  test("injects missing stub tools and forces stream on a bare free request", () => {
    const p = { model: "mimo-v2.6-flash-free", messages: [{ role: "user", content: "hi" }] }
    const mode = applyFreeTierFingerprint(p)
    assert.equal(mode, "aggregated")
    const names = p.tools.map((t) => t.function.name).sort()
    assert.deepEqual(names, ["bash", "glob", "grep", "read"])
    assert.equal(p.stream, true)
    assert.equal(p.stream_options.include_usage, true)
  })

  test("only adds missing stubs when the client already sent tools", () => {
    const mine = { type: "function", function: { name: "weather", parameters: { type: "object", properties: {} } } }
    const p = { model: "big-pickle", messages: [], tools: [mine] }
    const mode = applyFreeTierFingerprint(p)
    assert.equal(mode, "aggregated")
    const names = p.tools.map((t) => t.function.name)
    assert.equal(names[0], "weather") // client tool keeps its position
    assert.deepEqual(names.slice(1).sort(), ["bash", "glob", "grep", "read"])
  })

  test("client tools named with different case do not count as the stubs", () => {
    // Upstream matches the lowercase names exactly; PascalCase Bash/Glob/etc
    // do not satisfy the gate (2026-10-07 measurement) so lowercase stubs must
    // still be appended.
    const claude = { type: "function", function: { name: "Bash", parameters: { type: "object", properties: {} } } }
    const p = { model: "mimo-v2.6-flash-free", messages: [], tools: [claude] }
    applyFreeTierFingerprint(p)
    const lower = p.tools.map((t) => t.function.name).filter((n) => n === "bash")
    assert.equal(lower.length, 1, "a lowercase bash stub must be appended")
  })

  test("streaming request passes through without aggregation", () => {
    const p = { model: "mimo-v2.6-flash-free", messages: [], stream: true }
    const mode = applyFreeTierFingerprint(p)
    assert.equal(mode, "streamed")
    assert.equal(p.stream, true)
  })

  test("leaves paid models untouched", () => {
    const p = { model: "gpt-5.2", messages: [{ role: "user", content: "hi" }] }
    const mode = applyFreeTierFingerprint(p)
    assert.equal(mode, "untouched")
    assert.equal(p.tools, undefined)
    assert.equal(p.stream, undefined)
  })
})

describe("sessionFor IDs satisfy the descending-timestamp gate", () => {
  test("minted session IDs encode the current descending timestamp", () => {
    const sess = sessionFor(null)
    assert.ok(sess.injected, "no request means we mint one")
    const id = sess.value
    assert.ok(id.startsWith("ses_"), id)
    const body = id.slice(4)
    assert.equal(body.length, 26, "26-char ID body")
    // Decode the 12-hex prefix as the low 48 bits of ~(ts_ms*4096+counter).
    // Only the low 48 bits survive the inversion, so build the window from the
    // same truncation of the current time rather than the raw timestamp.
    let flipped = 0n
    for (const h of body.slice(0, 12)) flipped = (flipped << 4n) | BigInt(parseInt(h, 16))
    // After inversion the value DESCENDS as time advances (larger now_ms =>
    // smaller inverted value), so 'minted within the last minute' means flipped
    // lies between the inverted now-plus-margin and the inverted a-minute-ago
    // stamps. Forward margin: the suite may read the clock a hair before the
    // module minted the ID (coarse clock ticks), and the gate itself tolerates
    // 30 minutes of staleness, so 5s is nothing.
    const hi = ~(BigInt(Date.now() + 5_000) * 4096n) & 0xffffffffffffn
    const lo = ~(BigInt(Date.now() - 60_000) * 4096n) & 0xffffffffffffn
    assert.ok(flipped >= hi && flipped <= lo, `inverted stamp ${flipped.toString(16)} in window [${hi.toString(16)}, ${lo.toString(16)}]`)
    // tail must be base62 per the upstream alphabet
    assert.match(body.slice(12), /^[0-9A-Za-z]{14}$/)
  })
})

describe("aggregateChatStream synthesizes JSON from a forced SSE stream", () => {
  function sseResponse(chunks) {
    const sse = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n"
    const encoder = new TextEncoder()
    let sent = false
    return {
      body: {
        getReader() {
          return {
            read() {
              if (sent) return Promise.resolve({ done: true, value: undefined })
              sent = true
              return Promise.resolve({ done: false, value: encoder.encode(sse) })
            },
            cancel: () => {},
          }
        },
      },
    }
  }

  test("stitches content, finish reason and usage", async () => {
    const res = sseResponse([
      { id: "chatcmpl-x", created: 1700000000, choices: [{ index: 0, delta: { role: "assistant", content: "He" } }] },
      { choices: [{ index: 0, delta: { content: "llo" } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
    ])
    const out = await aggregateChatStream(res, "mimo-v2.6-flash-free")
    assert.equal(out.error, undefined)
    assert.equal(out.object, "chat.completion")
    assert.equal(out.model, "mimo-v2.6-flash-free")
    assert.equal(out.choices[0].message.content, "Hello")
    assert.equal(out.choices[0].finish_reason, "stop")
    assert.equal(out.usage.total_tokens, 5)
  })

  test("stitches tool calls and surfaces in-stream errors", async () => {
    const toolRes = sseResponse([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "bash", arguments: "{\"com" } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "mand\":\"ls\"}" } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ])
    const out = await aggregateChatStream(toolRes, "big-pickle")
    assert.equal(out.choices[0].message.tool_calls[0].function.name, "bash")
    assert.equal(out.choices[0].message.tool_calls[0].function.arguments, '{"command":"ls"}')

    const errRes = sseResponse([{ error: { type: "FreeTierError", message: "nope" } }])
    const err = await aggregateChatStream(errRes, "big-pickle")
    assert.equal(err.error.type, "FreeTierError")
  })
})
