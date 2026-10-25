import assert from "node:assert/strict"
import test from "node:test"

import { _internal } from "../index.mjs"

const {
  PLAYGROUND_URL,
  playgroundRequest,
  playgroundFetch,
  normalizeCompletion,
  normalizeChunk,
  messageOf,
  errorResponse,
  streamResponse,
} = _internal

const sse = (...chunks) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })

async function readStream(res) {
  return await res.text()
}

const lines = (text) =>
  text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))

test("playgroundRequest keeps only what the playground takes", () => {
  const out = playgroundRequest({
    model: "mercury-3",
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 512,
    stream: true,
    reasoning_effort: "high",
    temperature: 0.2,
    top_p: 0.9,
    stop: ["x"],
    tools: [{ type: "function" }],
    tool_choice: "auto",
    response_format: { type: "json_object" },
    stream_options: { include_usage: true },
    user: "u",
  })
  assert.deepEqual(out, {
    model: "mercury-3",
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 512,
    reasoning_effort: "high",
    stream: true,
  })
})

test("playgroundRequest makes stream explicit and takes max_completion_tokens", () => {
  assert.deepEqual(playgroundRequest({ model: "m", messages: [], max_completion_tokens: 32 }), {
    model: "m",
    messages: [],
    max_tokens: 32,
    stream: false,
  })
  assert.equal(playgroundRequest({ model: "m", messages: [] }).stream, false)
  assert.equal(playgroundRequest({ model: "m", messages: [], stream: false }).stream, false)
})

test("normalizeCompletion keeps the OpenAI fields and drops the extras", () => {
  const raw = {
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 1700000000,
    model: "mercury-3",
    warning: null,
    reasoning_summary: null,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "hello",
          tool_calls: [],
          tool_call_id: null,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 3,
      completion_tokens: 4,
      total_tokens: 7,
      completion_tokens_details: { reasoning_tokens: 2 },
    },
  }
  assert.deepEqual(normalizeCompletion(raw, "mercury-3"), {
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 1700000000,
    model: "mercury-3",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "hello" },
        finish_reason: "stop",
      },
    ],
    usage: raw.usage,
  })
})

test("normalizeCompletion wraps a plain content body", () => {
  const out = normalizeCompletion({ content: "plain" }, "mercury-3")
  assert.equal(out.choices[0].message.content, "plain")
  assert.equal(out.choices[0].finish_reason, "stop")
})

test("normalizeChunk drops null tool_calls and keeps usage", () => {
  const raw = {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1700000000,
    model: "mercury-3",
    reasoning_summary: null,
    choices: [{ index: 0, delta: { content: "hi", role: "assistant", tool_calls: null }, finish_reason: null }],
  }
  assert.deepEqual(normalizeChunk(raw), {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1700000000,
    model: "mercury-3",
    choices: [{ index: 0, delta: { role: "assistant", content: "hi" }, finish_reason: null }],
  })
})

test("messageOf unwraps FastAPI's detail", () => {
  const nested = JSON.stringify({
    error: {
      message: [{ type: "value_error", msg: "Model must be one of the following: mercury-3" }],
      type: "invalid_request_error",
    },
  })
  assert.equal(
    messageOf(JSON.stringify({ detail: nested }), 400),
    "Model must be one of the following: mercury-3",
  )
  assert.equal(
    messageOf(JSON.stringify({ detail: [{ msg: "first" }, { msg: "second" }] }), 422),
    "first; second",
  )
  assert.equal(messageOf("error code: 502", 502), "error code: 502")
  assert.equal(messageOf("", 500), "Mercury's playground answered HTTP 500")
})

test("errorResponse keeps a 4xx and turns a 5xx into 502", async () => {
  const bad = await errorResponse(
    new Response(JSON.stringify({ detail: "bad request" }), { status: 400 }),
  )
  assert.equal(bad.status, 400)
  assert.deepEqual(await bad.json(), {
    error: {
      message: "bad request",
      type: "invalid_request_error",
      param: null,
      code: null,
    },
  })

  const down = await errorResponse(new Response("boom", { status: 503 }))
  assert.equal(down.status, 502)
  assert.equal((await down.json()).error.type, "api_error")

  const unauthorized = await errorResponse(new Response("no", { status: 401 }))
  assert.equal(unauthorized.headers.get("x-magpie-sign-in"), "kept")
})

test("streamResponse normalizes chunks and ends once with [DONE]", async () => {
  const upstream = sse(
    {
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      created: 1,
      model: "mercury-3",
      choices: [{ index: 0, delta: { content: "Hel", role: "assistant", tool_calls: null }, finish_reason: null }],
      reasoning_summary: null,
    },
    {
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      created: 1,
      model: "mercury-3",
      choices: [{ index: 0, delta: { content: "lo" }, finish_reason: "stop" }],
    },
  )
  const body = await readStream(streamResponse(upstream, undefined))
  const out = lines(body)
  assert.equal(out.length, 3)
  assert.equal(out.at(-1), "[DONE]")
  const first = JSON.parse(out[0])
  assert.deepEqual(first.choices[0].delta, { role: "assistant", content: "Hel" })
  assert.equal(out.filter((line) => line === "[DONE]").length, 1)
})

test("streamResponse turns one JSON body into SSE", async () => {
  const upstream = new Response(
    JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1,
      model: "mercury-3",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
  const out = lines(await readStream(streamResponse(upstream, undefined)))
  assert.equal(out.at(-1), "[DONE]")
  const content = out
    .slice(0, -1)
    .map((line) => JSON.parse(line))
    .find((chunk) => chunk.choices[0]?.delta?.content === "hi")
  assert.ok(content)
  const usage = out
    .slice(0, -1)
    .map((line) => JSON.parse(line))
    .find((chunk) => chunk.usage)
  assert.equal(usage.usage.total_tokens, 3)
})

test("playgroundFetch turns an upstream error into OpenAI's envelope", async (t) => {
  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        detail: JSON.stringify({
          error: { message: "Model must be one of the following: mercury-3" },
        }),
      }),
      { status: 400 },
    )

  const res = await playgroundFetch("https://api.inceptionlabs.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "zzz", messages: [{ role: "user", content: "hi" }] }),
  })
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), {
    error: {
      message: "Model must be one of the following: mercury-3",
      type: "invalid_request_error",
      param: null,
      code: null,
    },
  })
})

test("playgroundFetch normalizes a streamed reply", async (t) => {
  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  globalThis.fetch = async () =>
    new Response(
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"mercury-3","choices":[{"index":0,"delta":{"role":"assistant","content":"hi","tool_calls":null},"finish_reason":null}],"reasoning_summary":null}\n\n' +
        'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"mercury-3","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
        "data: [DONE]\n\n",
      { status: 200, headers: { "content-type": "text/event-stream" } },
    )

  const res = await playgroundFetch("https://api.inceptionlabs.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "mercury-3",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    }),
  })
  const out = lines(await readStream(res))
  assert.equal(out.at(-1), "[DONE]")
  assert.deepEqual(JSON.parse(out[0]).choices[0].delta, { role: "assistant", content: "hi" })
  assert.equal("tool_calls" in JSON.parse(out[0]).choices[0].delta, false)
})

test("playgroundFetch rewrites the URL, drops the credential and filters the body", async (t) => {
  const calls = []
  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return new Response(
      JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1,
        model: "mercury-3",
        choices: [{ index: 0, message: { role: "assistant", content: "ok", tool_calls: [] }, finish_reason: "stop" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }

  const res = await playgroundFetch("https://api.inceptionlabs.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: "Bearer playground",
      "x-api-key": "leak",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "mercury-3",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
      temperature: 0.2,
      tools: [],
    }),
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, PLAYGROUND_URL)
  const headers = new Headers(calls[0].init.headers)
  assert.equal(headers.get("authorization"), null)
  assert.equal(headers.get("x-api-key"), null)
  const sent = JSON.parse(calls[0].init.body)
  assert.deepEqual(sent, {
    model: "mercury-3",
    messages: [{ role: "user", content: "hi" }],
    stream: false,
  })
  const body = await res.json()
  assert.equal(body.choices[0].message.content, "ok")
  assert.equal("tool_calls" in body.choices[0].message, false)
})
