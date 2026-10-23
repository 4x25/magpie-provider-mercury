import assert from "node:assert/strict"
import test from "node:test"

import { _internal } from "../index.mjs"

const {
  API_BASE,
  MODEL_IDS,
  configModels,
  modelOf,
  discoverModels,
  playgroundModels,
  fallbackModels,
} = _internal

const listing = {
  data: [
    {
      id: "mercury-2",
      name: "Inception: Mercury 2",
      context_length: 128000,
      max_output_length: 50000,
      pricing: {
        prompt: "0.00000025",
        completion: "0.00000075",
        input_cache_reads: "0.000000025",
        input_cache_writes: "0",
      },
      supported_endpoints: ["chat.completions"],
    },
    {
      id: "mercury-3",
      name: "Inception: Mercury 3",
      context_length: 1000000,
      max_output_length: 131072,
      pricing: { prompt: "0", completion: "0", input_cache_reads: "0" },
      supported_endpoints: ["chat.completions"],
    },
    {
      id: "mercury-edit-2",
      name: "Inception: Mercury Edit 2",
      context_length: 32000,
      max_output_length: 8192,
      supported_endpoints: ["fim.completions", "edit.completions"],
    },
    {
      id: "mercury-3-preview-1014",
      name: "Inception: Mercury 3 Preview",
      context_length: 1000000,
      max_output_length: 131072,
      supported_endpoints: ["chat.completions"],
    },
  ],
}

test("configModels declares the chat models and hides the others", () => {
  const models = configModels()
  for (const id of MODEL_IDS) {
    assert.ok(models[id], id)
    assert.equal(models[id].reasoning, true)
    assert.equal(models[id].tool_call, true)
    assert.deepEqual(Object.keys(models[id].variants), ["low", "medium", "high"])
  }
  assert.deepEqual(models["mercury-edit-2"], { disabled: true })
  assert.deepEqual(models["mercury-decide"], { disabled: true })
})

test("discoverModels keeps chat models and maps the listing", async () => {
  const models = await discoverModels("sk_test", async () => new Response(JSON.stringify(listing)))
  assert.deepEqual(Object.keys(models), ["mercury-3", "mercury-2", "mercury-3-preview-1014"])
  const three = models["mercury-3"]
  assert.equal(three.name, "Mercury 3")
  assert.equal(three.limit.context, 1000000)
  assert.equal(three.limit.output, 131072)
  // the listing says 0 during Mercury 3's discount: the known price stays
  assert.equal(three.cost.input, 0.1)
  assert.equal(three.cost.output, 0.35)
  assert.equal(three.cost.cache.read, 0.01)
  assert.equal(three.capabilities.toolcall, true)
  assert.equal(three.api.url, API_BASE)
  assert.equal(models["mercury-2"].cost.input, 0.25)
  assert.equal(models["mercury-2"].cost.cache.read, 0.025)
})

test("discoverModels fails rather than return an empty list", async () => {
  await assert.rejects(
    discoverModels("sk_test", async () => new Response(JSON.stringify({ data: [] }))),
    /empty|no chat models/i,
  )
  await assert.rejects(
    discoverModels("sk_test", async () => new Response("nope", { status: 500 })),
    /HTTP 500/,
  )
})

test("discoverModels treats a list without chat models as a failure", async () => {
  const body = { data: listing.data.filter((m) => m.id === "mercury-edit-2") }
  await assert.rejects(
    discoverModels("sk_test", async () => new Response(JSON.stringify(body))),
    /no chat models/,
  )
})

test("playgroundModels marks the models free and without tools", () => {
  const models = playgroundModels({
    "mercury-3": modelOf("mercury-3", { name: "Mercury 3" }),
  })
  assert.deepEqual(Object.keys(models), MODEL_IDS)
  for (const model of Object.values(models)) {
    assert.equal(model.free, true)
    assert.equal(model.capabilities.toolcall, false)
    assert.deepEqual(model.cost, { input: 0, output: 0, cache: { read: 0, write: 0 } })
  }
})

test("fallbackModels carries magpie's fallback mark", () => {
  const given = { "mercury-3": modelOf("mercury-3") }
  const out = fallbackModels(given)
  assert.equal(out[Symbol.for("magpie.fellBack")], true)
  assert.ok(out["mercury-3"])
  assert.equal(given[Symbol.for("magpie.fellBack")], undefined)
})