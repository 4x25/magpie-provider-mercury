// Mercury's lowest-latency effort is "instant", also used when the caller
// omits an effort. Keep the compatible name "none" until Magpie has finished
// routing and translating an explicit choice.

import { API_BASE } from "./catalog.mjs"

const api = new URL(API_BASE)
const chatPath = api.pathname + "/chat/completions"
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v)

export function upstreamEffort(value) {
  if (value === undefined) return "instant"
  return typeof value === "string" && value.trim().toLowerCase() === "none" ? "instant" : value
}

// Both account adapters read the serialized JSON supplied by Magpie's host
// or the SDK. Leave other body types untouched rather than consume a stream.
export async function bodyText(body) {
  if (typeof body === "string") return body
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return new TextDecoder().decode(body)
  if (body instanceof Blob) return body.text()
  return null
}

// API-key requests keep their URL, credentials, options and raw response.
// A serialized Chat Completions POST with an omitted effort or explicit
// "none" gets "instant". A Request's own stream is left to fetch, including
// cancellation.
export async function apiFetch(input, init = {}) {
  const request = input instanceof Request ? input : null
  let url
  try {
    url = new URL(request ? request.url : input)
  } catch {
    return fetch(input, init)
  }
  if (url.origin !== api.origin || url.pathname !== chatPath ||
      (init.method ?? request?.method ?? "GET").toUpperCase() !== "POST") {
    return fetch(input, init)
  }

  const text = await bodyText(init.body)
  if (text === null) return fetch(input, init)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return fetch(input, init)
  }
  if (!isObject(body)) return fetch(input, init)
  const effort = upstreamEffort(body.reasoning_effort)
  if (effort === body.reasoning_effort) return fetch(input, init)

  const headers = new Headers(init.headers ?? request?.headers ?? {})
  headers.delete("content-length")
  const json = JSON.stringify({ ...body, reasoning_effort: effort })
  // Keep fetch's implicit Content-Type: strings, bytes and Blobs each have
  // different defaults when the caller did not explicitly supply a header.
  const outgoing = typeof init.body === "string" ? json
    : init.body instanceof Blob ? new Blob([json], { type: init.body.type })
      : new TextEncoder().encode(json)
  return fetch(input, {
    ...init,
    headers,
    body: outgoing,
  })
}
