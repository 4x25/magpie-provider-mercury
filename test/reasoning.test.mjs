import assert from "node:assert/strict"
import test from "node:test"

import { _internal } from "../index.mjs"

const { API_BASE, PLAYGROUND_URL, apiFetch, upstreamEffort, playgroundRequest, playgroundFetch, bodyText } = _internal
const chatURL = API_BASE + "/chat/completions"
const user = { role: "user", content: 'Explain the text {"reasoning_effort":"none"}.' }

function mockFetch(t, result = new Response("fixture response")) {
  const calls = []
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async (input, init) => {
    calls.push({ input, init })
    return typeof result === "function" ? result() : result
  }
  return { calls, result }
}

test("upstreamEffort maps only the compatible none choice", () => {
  for (const value of ["none", " none ", "NONE"]) assert.equal(upstreamEffort(value), "instant")
  for (const value of ["low", "medium", "high", "instant", "minimal", "xhigh", "max", "", " low ", null, undefined, 0, false]) {
    assert.equal(upstreamEffort(value), value)
  }
})

const encodings = [
  ["a string", (text) => text],
  ["a Uint8Array", (text) => new TextEncoder().encode(text)],
  ["an ArrayBuffer", (text) => new TextEncoder().encode(text).buffer],
  ["a DataView", (text) => new DataView(new TextEncoder().encode(text).buffer)],
  ["a byte slice with an offset", (text) => new TextEncoder().encode("x" + text + "x").subarray(1, -1)],
  ["a Buffer", (text) => Buffer.from(text)],
  ["a Blob", (text) => new Blob([text], { type: "application/json" })],
]

for (const [name, encode] of encodings) {
  test(`API-key fetch maps none in ${name} without changing other fields`, async (t) => {
    const { calls, result } = mockFetch(t)
    const request = {
      model: "mercury-3",
      messages: [user],
      reasoning_effort: "none",
      tool_choice: "none",
      tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object" } } }],
      temperature: 0.7,
      response_format: { type: "json_object" },
      max_completion_tokens: 256,
      stream: true,
      stream_options: { include_usage: true },
    }
    const text = JSON.stringify(request)
    const headers = new Headers({
      authorization: "Bearer sk_fixture",
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(text)),
      "x-request-id": "fixture",
    })
    const controller = new AbortController()
    const init = {
      method: "POST", headers, body: encode(text), signal: controller.signal,
      redirect: "error", cache: "no-store",
    }
    const res = await apiFetch(chatURL, init)
    assert.equal(res, result)
    assert.equal(calls.length, 1)
    const sent = calls[0]
    assert.equal(sent.input, chatURL)
    assert.equal(sent.init.method, "POST")
    assert.equal(sent.init.signal, controller.signal)
    assert.equal(sent.init.redirect, "error")
    assert.equal(sent.init.cache, "no-store")
    assert.deepEqual(JSON.parse(await bodyText(sent.init.body)), { ...request, reasoning_effort: "instant" })
    assert.equal(sent.init.headers.get("authorization"), "Bearer sk_fixture")
    assert.equal(sent.init.headers.get("x-request-id"), "fixture")
    assert.equal(sent.init.headers.get("content-type"), "application/json")
    assert.equal(sent.init.headers.get("content-length"), null)
    assert.equal(headers.get("content-length"), String(Buffer.byteLength(text)))
    assert.equal(init.headers, headers)
    assert.notEqual(sent.init, init)
  })
}

const unchangedEfforts = [
  ["low", { reasoning_effort: "low" }],
  ["medium", { reasoning_effort: "medium" }],
  ["high", { reasoning_effort: "high" }],
  ["native instant", { reasoning_effort: "instant" }],
  ["minimal", { reasoning_effort: "minimal" }],
  ["omitted effort", {}],
  ["null effort", { reasoning_effort: null }],
  ["empty effort", { reasoning_effort: "" }],
  ["none outside the effort field", { tool_choice: "none", reasoning: { effort: "none" } }],
]

for (const [name, fields] of unchangedEfforts) {
  test(`API-key fetch keeps ${name} and the original serialized request`, async (t) => {
    const { calls } = mockFetch(t)
    const init = {
      method: "POST",
      headers: { authorization: "Bearer sk_fixture" },
      body: JSON.stringify({ model: "mercury-3", messages: [user], ...fields }, null, 2),
    }
    await apiFetch(chatURL, init)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].init, init)
    assert.equal(calls[0].input, chatURL)
  })
}

test("API-key conversion is scoped to the official chat POST endpoint", async (t) => {
  const { calls } = mockFetch(t)
  const bodies = JSON.stringify({ model: "mercury-3", messages: [user], reasoning_effort: "none" })
  for (const [url, method] of [
    [API_BASE + "/models", "GET"],
    [API_BASE + "/models", "POST"],
    [API_BASE + "/responses", "POST"],
    [chatURL, "PUT"],
    [chatURL, undefined],
    ["https://example.com/v1/chat/completions", "POST"],
    ["http://api.inceptionlabs.ai/v1/chat/completions", "POST"],
    ["https://api.inceptionlabs.ai:8443/v1/chat/completions", "POST"],
    ["invalid URL", "POST"],
  ]) {
    const init = { method, body: bodies }
    await apiFetch(url, init)
    assert.equal(calls.at(-1).input, url)
    assert.equal(calls.at(-1).init, init)
  }
  const input = new URL(chatURL + "?fixture=1")
  await apiFetch(input, { method: "post", body: bodies })
  assert.equal(calls.at(-1).input, input)
  assert.equal(JSON.parse(calls.at(-1).init.body).reasoning_effort, "instant")
})

test("invalid, nonobject and unsupported API-key bodies are forwarded unchanged", async (t) => {
  const { calls } = mockFetch(t)
  const stream = new ReadableStream({ start(controller) { controller.close() } })
  const form = new FormData()
  form.set("reasoning_effort", "none")
  for (const body of [undefined, null, "not json", "{", "null", "[]", '"none"', "0", stream, form, new URLSearchParams({ reasoning_effort: "none" })]) {
    const init = { method: "POST", body }
    await apiFetch(chatURL, init)
    assert.equal(calls.at(-1).init, init)
  }
  assert.equal(stream.locked, false)
})

test("API-key fetch leaves a Request body intact and maps explicit init overrides", async (t) => {
  const { calls } = mockFetch(t)
  const input = new Request(chatURL, {
    method: "POST",
    headers: { authorization: "Bearer sk_request", "content-type": "application/json", "content-length": "1" },
    body: JSON.stringify({ model: "mercury-3", messages: [user], reasoning_effort: "none" }),
    redirect: "error",
  })
  const requestInit = { cache: "no-store" }
  await apiFetch(input, requestInit)
  assert.equal(calls[0].input, input)
  assert.equal(calls[0].init, requestInit)
  assert.equal(input.bodyUsed, false)

  const init = {
    headers: { authorization: "Bearer sk_override", "content-type": "application/json" },
    body: JSON.stringify({ model: "mercury-2", reasoning_effort: "none" }),
  }
  await apiFetch(input, init)
  assert.deepEqual(JSON.parse(calls[1].init.body), { model: "mercury-2", reasoning_effort: "instant" })
  assert.equal(calls[1].init.headers.get("authorization"), "Bearer sk_override")
  assert.equal(input.bodyUsed, false)

  await apiFetch(input, { body: JSON.stringify({ model: "mercury-2", reasoning_effort: "none" }) })
  const effective = new Request(calls[2].input, calls[2].init)
  assert.equal(effective.method, "POST")
  assert.equal(effective.redirect, "error")
  assert.equal(effective.headers.get("authorization"), "Bearer sk_request")
  assert.equal(effective.headers.get("content-length"), null)
  assert.equal((await effective.json()).reasoning_effort, "instant")
  assert.equal(input.bodyUsed, false)

  const plain = new Request(chatURL, { method: "POST", body: JSON.stringify({ reasoning_effort: "low" }) })
  const plainInit = { cache: "no-store" }
  await apiFetch(plain, plainInit)
  assert.equal(calls[3].input, plain)
  assert.equal(calls[3].init, plainInit)
  assert.equal(await plain.text(), '{"reasoning_effort":"low"}')
})

test("API-key rewriting preserves implicit Content-Type for strings, bytes and Blobs", async (t) => {
  const { calls } = mockFetch(t)
  const text = JSON.stringify({ model: "mercury-3", reasoning_effort: "none" })
  for (const body of [text, new TextEncoder().encode(text), new Blob([text], { type: "application/json" }), new Blob([text])]) {
    const before = new Request(chatURL, { method: "POST", body })
    await apiFetch(chatURL, { method: "POST", body })
    const after = new Request(calls.at(-1).input, calls.at(-1).init)
    assert.equal(after.headers.get("content-type"), before.headers.get("content-type"))
    assert.equal((await after.json()).reasoning_effort, "instant")
  }
})

test("API-key fetch does not pre-read Request streams or delay their cancellation", async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const controller = new AbortController()
  const aborted = new Error("fixture streaming abort")
  let chunks
  const stream = new ReadableStream({ start(value) { chunks = value } })
  const input = new Request(chatURL, { method: "POST", body: stream, duplex: "half", signal: controller.signal })
  const init = { cache: "no-store" }
  let calls = 0
  globalThis.fetch = async (request, options) => {
    calls++
    assert.equal(request, input)
    assert.equal(options, init)
    assert.equal(request.bodyUsed, false)
    assert.equal(request.body.locked, false)
    assert.equal(request.signal.aborted, true)
    request.signal.throwIfAborted()
  }
  controller.abort(aborted)
  try {
    await assert.rejects(apiFetch(input, init), (err) => err === aborted)
    assert.equal(calls, 1)
    assert.equal(input.bodyUsed, false)
    assert.equal(input.body.locked, false)
  } finally {
    chunks.close()
  }
})

test("API-key fetch passes upstream errors and streaming responses through untouched", async (t) => {
  const error = new Response('{"error":{"message":"fixture limit"}}', { status: 429, headers: { "retry-after": "60" } })
  const { calls } = mockFetch(t, error)
  const init = { method: "POST", body: JSON.stringify({ reasoning_effort: "none" }) }
  const res = await apiFetch(chatURL, init)
  assert.equal(res, error)
  assert.equal(res.status, 429)
  assert.equal(res.headers.get("retry-after"), "60")
  assert.equal(res.bodyUsed, false)

  const sse = "data: {\"choices\":[]}\n\ndata: [DONE]\n\n"
  const upstream = new Response(sse, { headers: { "content-type": "text/event-stream" } })
  globalThis.fetch = async () => upstream
  const streamed = await apiFetch(chatURL, init)
  assert.equal(streamed, upstream)
  assert.equal(streamed.bodyUsed, false)
  assert.equal(await streamed.text(), sse)
  assert.equal(calls.length, 1)
})

test("API-key fetch preserves abort signals and upstream exceptions", async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const controller = new AbortController()
  const aborted = new Error("fixture abort")
  controller.abort(aborted)
  let calls = 0
  globalThis.fetch = async (_input, init) => {
    calls++
    assert.equal(init.signal, controller.signal)
    assert.equal(JSON.parse(init.body).reasoning_effort, "instant")
    init.signal.throwIfAborted()
  }
  await assert.rejects(apiFetch(chatURL, {
    method: "POST", body: JSON.stringify({ reasoning_effort: "none" }), signal: controller.signal,
  }), (err) => err === aborted)
  const failure = new Error("fixture network failure")
  globalThis.fetch = async () => { throw failure }
  await assert.rejects(apiFetch(chatURL, { method: "POST", body: JSON.stringify({ reasoning_effort: "none" }) }), (err) => err === failure)
  assert.equal(calls, 1)
})

for (const [asked, sent] of [["none", "instant"], [" NONE ", "instant"], ["low", "low"], ["medium", "medium"], ["high", "high"], ["instant", "instant"]]) {
  test(`Playground maps effort ${JSON.stringify(asked)} to ${sent}`, async (t) => {
    const request = { model: "mercury-3", messages: [user], reasoning_effort: asked, stream: false }
    assert.deepEqual(playgroundRequest(request), { ...request, reasoning_effort: sent })
    assert.equal(request.reasoning_effort, asked)
    const { calls } = mockFetch(t, Response.json({ content: "fixture answer" }))
    const res = await playgroundFetch(chatURL, {
      method: "POST", headers: { authorization: "Bearer playground" }, body: JSON.stringify(request),
    })
    assert.equal(res.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].input, PLAYGROUND_URL)
    assert.equal(JSON.parse(calls[0].init.body).reasoning_effort, sent)
    assert.equal(calls[0].init.headers.get("authorization"), null)
  })
}

test("Playground keeps its upstream default for omitted, null and empty effort", async (t) => {
  const { calls } = mockFetch(t, () => Response.json({ content: "fixture answer" }))
  for (const fields of [{}, { reasoning_effort: null }, { reasoning_effort: "" }, { reasoning_effort: " " }]) {
    const request = { model: "mercury-3", messages: [user], ...fields, stream: false }
    assert.equal(Object.hasOwn(playgroundRequest(request), "reasoning_effort"), false)
    await playgroundFetch(chatURL, { body: JSON.stringify(request) })
    assert.equal(Object.hasOwn(JSON.parse(calls.at(-1).init.body), "reasoning_effort"), false)
  }
})

test("Playground effort conversion leaves the tool guard and cancellation intact", async (t) => {
  const { calls } = mockFetch(t, Response.json({ content: "fixture answer" }))
  const res = await playgroundFetch(chatURL, {
    method: "POST",
    body: JSON.stringify({ model: "mercury-3", messages: [user], reasoning_effort: "none", tools: [{ type: "function" }] }),
  })
  assert.equal(res.status, 400)
  assert.equal(res.headers.get("x-magpie-sign-in"), "kept")
  assert.equal(calls.length, 0)
  const controller = new AbortController()
  await playgroundFetch(chatURL, {
    method: "POST", signal: controller.signal,
    body: JSON.stringify({ model: "mercury-3", messages: [user], reasoning_effort: "none", tools: [], stream: false }),
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].init.signal, controller.signal)
  assert.deepEqual(JSON.parse(calls[0].init.body), { model: "mercury-3", messages: [user], reasoning_effort: "instant", stream: false })
})
