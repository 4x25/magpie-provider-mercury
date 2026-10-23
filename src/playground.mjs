// The Mercury playground (the endpoint behind Inception's own web playground)
// speaks a small OpenAI-compatible subset. This module adapts one Chat
// Completions request to it and normalizes what comes back:
//
//  - only model, messages, max_tokens, stream and reasoning_effort are sent;
//    everything else (tools, temperature, stop, response_format, …) is
//    silently ignored upstream, so it is dropped here rather than passed on;
//  - stream is always explicit: leaving it out makes the endpoint answer SSE;
//  - errors are FastAPI's {"detail": …}, turned into OpenAI's error envelope;
//  - replies are reduced to OpenAI's own fields (the endpoint adds
//    tool_call_id, reasoning_summary, warning and empty tool_calls), and a
//    stream always ends with [DONE].

import { PLAYGROUND_URL } from "./catalog.mjs"

const encoder = new TextEncoder()

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v)

export const PLAYGROUND_PARAMS = [
  "model",
  "messages",
  "max_tokens",
  "stream",
  "reasoning_effort",
]

// playgroundRequest is the body the playground takes from a Chat Completions
// request. max_completion_tokens becomes max_tokens: the endpoint has only the
// latter.
export function playgroundRequest(body) {
  const out = {}
  if (isObject(body)) {
    if (typeof body.model === "string") out.model = body.model
    if (Array.isArray(body.messages)) out.messages = body.messages
    const max = Number.isFinite(body.max_tokens)
      ? body.max_tokens
      : Number.isFinite(body.max_completion_tokens)
        ? body.max_completion_tokens
        : undefined
    if (max !== undefined && max > 0) out.max_tokens = max
    if (typeof body.reasoning_effort === "string" && body.reasoning_effort.trim()) {
      out.reasoning_effort = body.reasoning_effort.trim()
    }
  }
  out.stream = isObject(body) && body.stream === true
  return out
}

// playgroundFetch makes an account's request against the playground. The
// loader gives it every request of a playground sign-in, so it rewrites the
// URL, drops the account's credential and adapts the body.
export async function playgroundFetch(_input, init = {}) {
  const headers = new Headers(init.headers ?? {})
  for (const name of [
    "authorization",
    "x-api-key",
    "api-key",
    "cookie",
    "origin",
    "referer",
    "content-length",
  ]) {
    headers.delete(name)
  }
  const text = await bodyText(init.body)
  let body = null
  if (text !== null) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }
  const outgoing = isObject(body) ? playgroundRequest(body) : null
  if (outgoing) headers.set("content-type", "application/json")

  const res = await fetch(PLAYGROUND_URL, {
    method: init.method ?? "POST",
    headers,
    body: outgoing ? JSON.stringify(outgoing) : init.body,
    signal: init.signal,
    redirect: "error",
  })

  if (!res.ok) return errorResponse(res)
  if (outgoing?.stream === true) return streamResponse(res, init.signal)
  return jsonResponse(res, outgoing?.model ?? body?.model ?? "")
}

async function bodyText(body) {
  if (typeof body === "string") return body
  if (body instanceof Uint8Array) return new TextDecoder().decode(body)
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body)
  return null
}

// ---- replies -----------------------------------------------------------------

export function normalizeCompletion(raw, model = "") {
  if (!isObject(raw)) return null
  const choices = (Array.isArray(raw.choices) ? raw.choices : [])
    .filter(isObject)
    .map((choice, i) => {
      const message = isObject(choice.message) ? choice.message : {}
      const out = {
        role: typeof message.role === "string" ? message.role : "assistant",
        content: typeof message.content === "string" ? message.content : null,
      }
      if (typeof message.reasoning_content === "string" && message.reasoning_content) {
        out.reasoning_content = message.reasoning_content
      }
      if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
        out.tool_calls = message.tool_calls
      }
      if (isObject(message.function_call) && Object.keys(message.function_call).length) {
        out.function_call = message.function_call
      }
      if (typeof message.refusal === "string" && message.refusal) out.refusal = message.refusal
      return {
        index: Number.isFinite(choice.index) ? choice.index : i,
        message: out,
        finish_reason: typeof choice.finish_reason === "string" ? choice.finish_reason : "stop",
      }
    })

  if (!choices.length) {
    if (typeof raw.content !== "string") return null
    choices.push({
      index: 0,
      message: { role: "assistant", content: raw.content },
      finish_reason: "stop",
    })
  }

  const completion = {
    id: typeof raw.id === "string" && raw.id ? raw.id : `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Number.isFinite(raw.created) ? raw.created : Math.floor(Date.now() / 1000),
    model: typeof raw.model === "string" && raw.model ? raw.model : model,
    choices,
  }
  if (isObject(raw.usage)) completion.usage = raw.usage
  return completion
}

export function normalizeChunk(raw) {
  if (!isObject(raw)) return null
  const chunk = {
    id: typeof raw.id === "string" && raw.id ? raw.id : `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion.chunk",
    created: Number.isFinite(raw.created) ? raw.created : Math.floor(Date.now() / 1000),
    model: typeof raw.model === "string" ? raw.model : "",
    choices: [],
  }
  const choices = Array.isArray(raw.choices) ? raw.choices : []
  choices.forEach((choice, i) => {
    if (!isObject(choice)) return
    const delta = isObject(choice.delta) ? choice.delta : {}
    const out = {}
    if (typeof delta.role === "string") out.role = delta.role
    if (typeof delta.content === "string") out.content = delta.content
    else if (delta.content === null) out.content = null
    if (typeof delta.reasoning_content === "string") out.reasoning_content = delta.reasoning_content
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) out.tool_calls = delta.tool_calls
    if (isObject(delta.function_call) && Object.keys(delta.function_call).length) {
      out.function_call = delta.function_call
    }
    if (typeof delta.refusal === "string") out.refusal = delta.refusal
    chunk.choices.push({
      index: Number.isFinite(choice.index) ? choice.index : i,
      delta: out,
      finish_reason: typeof choice.finish_reason === "string" ? choice.finish_reason : null,
    })
  })
  if (isObject(raw.usage)) chunk.usage = raw.usage
  return chunk
}

// ---- responses ---------------------------------------------------------------

async function jsonResponse(res, model) {
  const text = await res.text()
  let raw = null
  try {
    raw = JSON.parse(text)
  } catch {
    raw = null
  }
  const completion = normalizeCompletion(raw, model) ?? completionFromText(text, model)
  return json(completion, res.status)
}

function completionFromText(text, model) {
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text ?? "" },
        finish_reason: "stop",
      },
    ],
  }
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

// streamResponse normalizes the endpoint's SSE. It also accepts one JSON body
// (some days the endpoint ignores stream) and turns it into the same SSE.
export function streamResponse(res, signal) {
  const upstream = res.body
  const sse = new ReadableStream({
    async start(controller) {
      const write = (chunk) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
      const done = () => controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      let sawDone = false
      try {
        if (isEventStream(res) && upstream) {
          const reader = upstream.getReader()
          const decoder = new TextDecoder()
          let buffer = ""
          try {
            while (!sawDone) {
              const { done: atEnd, value } = await reader.read()
              if (atEnd) break
              buffer += decoder.decode(value, { stream: true })
              let sep
              while ((sep = buffer.match(/\r?\n\r?\n/))) {
                const block = buffer.slice(0, sep.index)
                buffer = buffer.slice(sep.index + sep[0].length)
                const data = dataOf(block)
                if (data === null) continue
                if (data === "[DONE]") {
                  sawDone = true
                  break
                }
                let raw
                try {
                  raw = JSON.parse(data)
                } catch {
                  continue
                }
                if (isObject(raw) && raw.error !== undefined) {
                  write({ error: errorOf(raw.error, "api_error") })
                  continue
                }
                const chunk = normalizeChunk(raw)
                if (chunk) write(chunk)
              }
            }
            if (!sawDone) {
              const data = dataOf(buffer)
              if (data && data !== "[DONE]") {
                try {
                  const chunk = normalizeChunk(JSON.parse(data))
                  if (chunk) write(chunk)
                } catch {
                  /* a torn final block is dropped */
                }
              }
            }
          } finally {
            reader.releaseLock()
          }
        } else {
          const text = await res.text().catch(() => "")
          let raw = null
          try {
            raw = JSON.parse(text)
          } catch {
            raw = null
          }
          const completion = normalizeCompletion(raw, "") ?? completionFromText(text, "")
          for (const chunk of chunksOf(completion)) write(chunk)
        }
      } catch (e) {
        if (!signal?.aborted) {
          write({ error: errorOf(e?.message ?? String(e), "api_error") })
        }
      } finally {
        if (!signal?.aborted) {
          try {
            done()
          } catch {
            /* the client went away */
          }
        }
        try {
          controller.close()
        } catch {
          /* the client went away */
        }
      }
    },
    cancel(reason) {
      try {
        return upstream?.cancel?.(reason)
      } catch {
        return undefined
      }
    },
  })
  return new Response(sse, {
    status: res.status,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  })
}

function chunksOf(completion) {
  const base = { id: completion.id, created: completion.created, model: completion.model }
  const chunks = []
  for (const choice of completion.choices) {
    chunks.push({
      ...base,
      object: "chat.completion.chunk",
      choices: [
        {
          index: choice.index,
          delta: { role: choice.message.role, content: choice.message.content ?? "" },
          finish_reason: null,
        },
      ],
    })
    chunks.push({
      ...base,
      object: "chat.completion.chunk",
      choices: [{ index: choice.index, delta: {}, finish_reason: choice.finish_reason }],
    })
  }
  if (completion.usage) {
    chunks.push({ ...base, object: "chat.completion.chunk", choices: [], usage: completion.usage })
  }
  return chunks
}

function isEventStream(res) {
  return String(res.headers.get("content-type") ?? "").includes("text/event-stream")
}

function dataOf(block) {
  const data = []
  for (const line of String(block).split(/\r?\n/)) {
    if (line.startsWith(":")) continue
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""))
  }
  return data.length ? data.join("\n") : null
}

// ---- errors ------------------------------------------------------------------

export async function errorResponse(res) {
  const text = await res.text().catch(() => "")
  const message = messageOf(text, res.status)
  const status = res.status >= 400 && res.status < 500 ? res.status : 502
  const type =
    status === 401 || status === 403
      ? "authentication_error"
      : status >= 500
        ? "api_error"
        : "invalid_request_error"
  const headers = { "content-type": "application/json; charset=utf-8" }
  // A refused request to the playground is not a refused sign-in: the
  // account has none to expire.
  if (status === 401 || status === 403) headers["x-magpie-sign-in"] = "kept"
  return new Response(
    JSON.stringify({ error: { message, type, param: null, code: null } }),
    { status, headers },
  )
}

// messageOf finds the message in FastAPI's {"detail": …} (a string holding
// another JSON body, or a list of validation errors), in OpenAI's own error
// envelope, or in plain text.
export function messageOf(text, status = 0) {
  const raw = String(text ?? "").trim()
  let body = null
  try {
    body = JSON.parse(raw)
  } catch {
    body = null
  }
  const message = messageIn(body)
  if (message) return message
  if (raw && raw.length <= 1000) return raw
  return `Mercury's playground answered HTTP ${status || 502}`
}

function messageIn(body) {
  if (Array.isArray(body)) {
    return body
      .map((item) => messageIn(item) || text(item))
      .filter(Boolean)
      .join("; ")
  }
  if (!isObject(body)) return ""
  const error = body.error
  if (typeof error === "string" && error.trim()) return error.trim()
  if (isObject(error)) {
    const message = messageIn(error)
    if (message) return message
  }
  const detail = body.detail
  if (typeof detail === "string") {
    const nested = messageIn(parse(detail))
    return nested || detail.trim()
  }
  if (Array.isArray(detail)) return messageIn(detail)
  if (Array.isArray(body.message)) {
    const message = messageIn(body.message)
    if (message) return message
  }
  if (typeof body.message === "string" && body.message.trim()) return body.message.trim()
  if (typeof body.msg === "string" && body.msg.trim()) return body.msg.trim()
  return ""
}

function parse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function text(value) {
  return typeof value === "string" ? value : JSON.stringify(value)
}

function errorOf(value, type) {
  if (isObject(value)) {
    return {
      message: messageIn(value) || text(value),
      type: typeof value.type === "string" ? value.type : type,
      param: value.param ?? null,
      code: value.code ?? null,
    }
  }
  return { message: String(value), type, param: null, code: null }
}
