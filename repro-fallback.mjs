import fs from "node:fs"
const zp = await import("./zen-proxy.mjs")
const lines = []
try {
  zp.saveConfig({ fallbackModels: ["big-pickle", "space-bunny-free"], defaultModel: "", autoSyncIntervalMs: 0, cacheMs: 0 })
  globalThis.fetch = async (url, opts) => {
    const sent = JSON.parse(opts.body)
    lines.push("SENT " + sent.model + " stream=" + sent.stream + " ntools=" + (sent.tools || []).length)
    if (sent.model === "big-pickle")
      return new Response(JSON.stringify({ type: "error", error: { type: "FreeTierError", message: "gate" } }), { status: 403, headers: { "content-type": "application/json" } })
    return new Response(JSON.stringify({ model: "space-bunny-free", choices: [{ message: { role: "assistant", content: "hi" } }] }), { status: 200, headers: { "content-type": "application/json" } })
  }
  let finishCb
  const res = {
    status: 200, headers: {}, chunks: [],
    writeHead(s) { this.status = s },
    write(c) { this.chunks.push(String(c)) },
    end(c) { if (c !== undefined) this.chunks.push(String(c)); if (finishCb) finishCb() },
    setHeader() {},
    on(ev, cb) { if (ev === "finish") finishCb = cb; return this },
  }
  const req = { headers: {}, socket: { remoteAddress: "127.0.0.1" }, method: "POST", url: "/v1/chat/completions", signal: new AbortController().signal, on() { return this }, destroy() {}, [Symbol.asyncIterator]: async function* () { yield JSON.stringify({ model: "big-pickle", messages: [] }) } }
  await zp.handleChat(req, res)
  lines.push("STATUS " + res.status)
  lines.push("BODY " + res.chunks.join("").slice(0, 300))
} catch (e) {
  lines.push("ERR " + e.message)
}
fs.writeFileSync("fp8.txt", lines.join("\n"))
process.exit(0)
