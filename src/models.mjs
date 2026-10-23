// The provider's model list: what it shows before sign-in, what a key account
// reads from Inception's /v1/models, and what the playground serves.

import {
  API_BASE,
  EFFORTS,
  MODEL_IDS,
  PROVIDER,
  SDK,
  STATIC_MODELS,
} from "./catalog.mjs"

const MODELS_TIMEOUT = 15000

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v)

// variants is OpenCode's reasoning levels: the keys are the levels, and each
// carries the request option OpenAI-compatible models take for it.
export function variants() {
  return Object.fromEntries(EFFORTS.map((e) => [e, { reasoningEffort: e }]))
}

// configModel is a model as the config hook declares it.
export function configModel(id) {
  const meta = STATIC_MODELS[id]
  return {
    name: meta.name,
    limit: { context: meta.context, output: meta.output },
    reasoning: true,
    tool_call: true,
    attachment: false,
    modalities: { input: ["text"], output: ["text"] },
    cost: {
      input: meta.cost.input,
      output: meta.cost.output,
      cache_read: meta.cost.cache_read,
      cache_write: 0,
    },
    variants: variants(),
  }
}

export function configModels() {
  const models = {}
  for (const id of MODEL_IDS) models[id] = configModel(id)
  // models.dev lists both; neither answers chat completions (Mercury Edit 2
  // is FIM/edit, Mercury Decide is the decisions endpoint).
  models["mercury-edit-2"] = { disabled: true }
  models["mercury-decide"] = { disabled: true }
  return models
}

// modelOf is a model in the shape a provider.models hook returns.
export function modelOf(id, meta = {}) {
  const known = STATIC_MODELS[id] ?? {}
  const context = positive(meta.context) ?? known.context ?? 0
  const output = positive(meta.output) ?? known.output ?? 0
  const cost = meta.cost ?? {}
  const fallback = known.cost ?? {}
  return {
    id,
    providerID: PROVIDER,
    name: meta.name ?? known.name ?? id,
    api: { id, url: API_BASE, npm: SDK },
    status: "active",
    headers: {},
    options: {},
    cost: {
      input: numberOr(cost.input, fallback.input ?? 0),
      output: numberOr(cost.output, fallback.output ?? 0),
      cache: {
        read: numberOr(cost.cache_read, fallback.cache_read ?? 0),
        write: 0,
      },
    },
    limit: { context, input: context, output },
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, image: false, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: variants(),
  }
}

// playgroundModels is what the playground serves. It ignores tools, so the
// models say they take none rather than let an agent plan on them.
export function playgroundModels(given = {}) {
  const models = {}
  for (const id of MODEL_IDS) {
    const base = given[id] ?? modelOf(id)
    models[id] = {
      ...base,
      id,
      providerID: PROVIDER,
      capabilities: {
        ...(base.capabilities ?? {}),
        reasoning: true,
        attachment: false,
        toolcall: false,
        input: { text: true, image: false, audio: false, video: false, pdf: false },
        output: { text: true, image: false, audio: false, video: false, pdf: false },
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      free: true,
      variants: variants(),
    }
  }
  return models
}

// fallbackModels is the list the hook was given, marked as a fallback so
// magpie keeps the list it already had (docs: magpie.fellBack).
export function fallbackModels(given = {}) {
  const models = { ...given }
  models[Symbol.for("magpie.fellBack")] = true
  return models
}

// discoverModels reads Inception's public model list and keeps the models
// that answer chat completions. An empty list is a failure: the caller falls
// back rather than hide every model.
export async function discoverModels(key, fetchImpl = fetch) {
  const headers = { accept: "application/json" }
  if (key) headers.authorization = `Bearer ${key}`
  const res = await fetchImpl(`${API_BASE}/models`, {
    headers,
    signal: AbortSignal.timeout(MODELS_TIMEOUT),
    redirect: "error",
  })
  if (!res.ok) throw new Error(`Inception's model list answered HTTP ${res.status}`)
  const body = await res.json()
  const listed = Array.isArray(body?.data) ? body.data : []
  const models = {}
  for (const raw of listed) {
    if (!isObject(raw) || typeof raw.id !== "string" || !raw.id) continue
    const endpoints = Array.isArray(raw.supported_endpoints)
      ? raw.supported_endpoints
      : ["chat.completions"]
    if (!endpoints.includes("chat.completions")) continue
    models[raw.id] = modelOf(raw.id, {
      name: displayName(raw.name),
      context: raw.context_length,
      output: raw.max_output_length,
      cost: priceOf(raw.pricing),
    })
  }
  if (Object.keys(models).length === 0) {
    throw new Error("Inception's model list had no chat models")
  }
  return sortModels(models)
}

function displayName(name) {
  if (typeof name !== "string") return undefined
  const trimmed = name.replace(/^Inception:\s*/i, "").trim()
  return trimmed || undefined
}

// priceOf turns the per-token strings /v1/models gives into a price per
// million tokens. A zero is no price a list named (Mercury 3's entry says 0
// during its launch discount), so the static price stays.
function priceOf(pricing) {
  if (!isObject(pricing)) return undefined
  const cost = {
    input: perMillion(pricing.prompt),
    output: perMillion(pricing.completion),
    cache_read: perMillion(pricing.input_cache_reads),
  }
  return Object.values(cost).some((v) => v !== undefined) ? cost : undefined
}

function perMillion(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return undefined
  // per-token strings carry up to nine decimals; a per-million price has
  // three, and the multiplication leaves float noise (0.025 → 0.024999…)
  return Math.round(n * 1_000_000 * 1_000_000) / 1_000_000
}

function positive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

// sortModels puts the models the plugin knows first, in the catalog's order,
// then anything new the vendor listed.
function sortModels(models) {
  const order = new Map(MODEL_IDS.map((id, i) => [id, i]))
  return Object.fromEntries(
    Object.entries(models).sort(([a], [b]) => {
      const ia = order.get(a) ?? MODEL_IDS.length
      const ib = order.get(b) ?? MODEL_IDS.length
      return ia - ib || a.localeCompare(b)
    }),
  )
}