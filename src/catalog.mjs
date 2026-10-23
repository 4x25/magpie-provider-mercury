// The Inception Labs provider as Magpie knows it: ids, endpoints, the models
// it serves and the reasoning levels they take.

export const PROVIDER = "inception"

// Inception's OpenAI-compatible API, used with a key made at
// https://platform.inceptionlabs.ai/dashboard/api-keys
export const API_BASE = "https://api.inceptionlabs.ai/v1"

// The public endpoint behind Inception's own playground. It takes no key and
// speaks a small OpenAI-compatible subset; playground.mjs adapts it.
export const PLAYGROUND_BASE = "https://web-api-proxy.inceptionlabs.ai/v1"
export const PLAYGROUND_URL = PLAYGROUND_BASE + "/playground"

export const SDK = "@ai-sdk/openai-compatible"

// The word typed in the API key field (instead of a key) to use the
// playground.
export const PLAYGROUND_KEY = "playground"

// Magpie's reasoning levels, weakest first. Mercury also takes "instant",
// but Magpie normalizes reasoning_effort to its own levels (low/medium/high)
// on the way to a plugin, so offering instant would be a choice that sends
// nothing. A client that does send instant itself still reaches Inception.
export const EFFORTS = ["low", "medium", "high"]

// What Inception's model page and models.dev say about the chat models.
// `/v1/models` refreshes the numbers when it answers; these are the fallback.
export const STATIC_MODELS = {
  "mercury-3": {
    name: "Mercury 3",
    context: 1000000,
    output: 131072,
    cost: { input: 0.1, output: 0.35, cache_read: 0.01 },
  },
  "mercury-2.5": {
    name: "Mercury 2.5",
    context: 260000,
    output: 65536,
    cost: { input: 0.2, output: 0.75, cache_read: 0.02 },
  },
  "mercury-2": {
    name: "Mercury 2",
    context: 128000,
    output: 50000,
    cost: { input: 0.25, output: 0.75, cache_read: 0.025 },
  },
}

export const MODEL_IDS = Object.keys(STATIC_MODELS)