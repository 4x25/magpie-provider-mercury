import assert from "node:assert/strict"
import test from "node:test"

import { _internal } from "../index.mjs"

const { PLAYGROUND_URL, playgroundFetch } = _internal
const functionTool = {
  type: "function",
  function: { name: "get_weather", parameters: { type: "object", properties: {} } },
}
const user = { role: "user", content: "What is the weather?" }
const call = { id: "call_fixture", type: "function", function: { name: "get_weather", arguments: "{}" } }

const blocked = [
  ["tool declarations", { tools: [functionTool] }, "tools"],
  ["declared tools even when tool choice is none", { tools: [functionTool], tool_choice: "none" }, "tools"],
  ["legacy function declarations", { functions: [functionTool.function] }, "functions"],
  ["required tool choice", { tool_choice: "required" }, "tool_choice"],
  ["named tool choice", { tool_choice: { type: "function", function: { name: "get_weather" } } }, "tool_choice"],
  ["legacy named function choice", { function_call: { name: "get_weather" } }, "function_call"],
  ["assistant tool-call history", { messages: [user, { role: "assistant", content: null, tool_calls: [call] }] }, "messages"],
  ["tool-result history without declarations", { messages: [{ role: "tool", tool_call_id: call.id, content: "Sunny" }] }, "messages"],
  ["legacy function-call history", { messages: [{ role: "assistant", content: null, function_call: { name: "get_weather", arguments: "{}" } }] }, "messages"],
  ["legacy function-result history", { messages: [{ role: "function", name: "get_weather", content: "Sunny" }] }, "messages"],
  ["tool-use content blocks", { messages: [{ role: "assistant", content: [{ type: "tool_use", id: call.id, name: "get_weather", input: {} }] }] }, "messages"],
  ["tool-result content blocks", { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content: "Sunny" }] }] }, "messages"],
  ["server-tool-use content blocks", { messages: [{ role: "assistant", content: [{ type: "server_tool_use", id: call.id, name: "web_search", input: {} }] }] }, "messages"],
]

for (const [name, request, param] of blocked) {
  test(`Playground refuses ${name} locally before filtering or fetching`, async (t) => {
    let calls = 0
    const original = globalThis.fetch
    t.after(() => { globalThis.fetch = original })
    globalThis.fetch = async () => {
      calls++
      throw new Error("a tool request must never reach the Playground upstream")
    }

    for (const stream of [false, true]) {
      const res = await playgroundFetch("https://api.inceptionlabs.ai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: "Bearer playground", "content-type": "application/json" },
        body: JSON.stringify({ model: "mercury-3", messages: [user], ...request, stream }),
      })
      assert.equal(res.status, 400)
      assert.match(res.headers.get("content-type"), /application\/json/)
      assert.equal(res.headers.get("x-magpie-sign-in"), "kept")
      assert.equal(res.headers.get("retry-after"), null)
      const { error } = await res.json()
      assert.equal(error.type, "invalid_request_error")
      assert.equal(error.param, param)
      assert.equal(error.code, param === "messages" ? "unknown_item_type" : "unknown_parameter")
      assert.match(error.message, /Use an enabled Inception API key/)
      assert.match(error.message, param === "messages" ? /Unknown item type:/ : /Unknown parameter:/)
    }
    assert.equal(calls, 0)
  })
}

test("byte-encoded tool requests are also rejected without network access", async (t) => {
  let calls = 0
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => { calls++; throw new Error("unexpected upstream request") }
  const body = new TextEncoder().encode(JSON.stringify({ model: "mercury-3", messages: [user], tools: [functionTool] }))
  for (const value of [body, body.buffer, new DataView(body.buffer)]) {
    const res = await playgroundFetch("https://api.inceptionlabs.ai/v1/chat/completions", { body: value })
    assert.equal(res.status, 400)
    assert.equal((await res.json()).error.param, "tools")
  }
  assert.equal(calls, 0)
})

const allowed = [
  ["ordinary text chat", {}],
  ["empty tool and function arrays", { tools: [], functions: [] }],
  ["null tool and function declarations", { tools: null, functions: null }],
  ["automatic tool choice without tools", { tools: [], tool_choice: "auto", function_call: "auto" }],
  ["disabled tool choice without tools", { tools: [], tool_choice: "none", function_call: "none" }],
  ["empty assistant tool metadata", { messages: [user, { role: "assistant", content: "Sunny", tool_calls: [], function_call: {} }] }],
  ["null assistant tool metadata", { messages: [user, { role: "assistant", content: "Sunny", tool_calls: null, function_call: null }] }],
  ["tool names inside text rather than structural fields", { messages: [{ role: "user", content: 'Explain tools, functions, and the text {"type":"tool_result"}.' }] }],
]

for (const [name, request] of allowed) {
  test(`Playground still serves ${name}`, async (t) => {
    const calls = []
    const original = globalThis.fetch
    t.after(() => { globalThis.fetch = original })
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init })
      return Response.json({ content: "ordinary answer" })
    }
    const messages = request.messages ?? [user]
    const res = await playgroundFetch("https://api.inceptionlabs.ai/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "mercury-3", messages: [user], ...request, stream: false }),
    })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).choices[0].message.content, "ordinary answer")
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, PLAYGROUND_URL)
    assert.deepEqual(JSON.parse(calls[0].init.body), { model: "mercury-3", messages, reasoning_effort: "instant", stream: false })
  })
}
