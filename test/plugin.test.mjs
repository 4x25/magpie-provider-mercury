import assert from "node:assert/strict"
import test from "node:test"

import plugin, { _internal } from "../index.mjs"

const { API_BASE, PLAYGROUND_BASE, PROVIDER, isPlaygroundAuth, authMethod } = _internal

const hooks = () => plugin({ client: { app: { log: async () => {} } } })

test("the plugin declares the Inception provider with its models", async () => {
  const { config } = await hooks()
  const cfg = { provider: {} }
  await config(cfg)
  const provider = cfg.provider[PROVIDER]
  assert.equal(provider.name, "Inception (Mercury)")
  assert.equal(provider.npm, "@ai-sdk/openai-compatible")
  assert.equal(provider.api, API_BASE)
  assert.deepEqual(Object.keys(provider.models), [
    "mercury-3",
    "mercury-2.5",
    "mercury-2",
    "mercury-edit-2",
    "mercury-decide",
  ])
  assert.deepEqual(provider.models["mercury-decide"], { disabled: true })
})

test("config keeps what the user already set", async () => {
  const { config } = await hooks()
  const cfg = {
    provider: {
      inception: { name: "Mine", models: { "mercury-3": { name: "Custom" } } },
    },
  }
  await config(cfg)
  const provider = cfg.provider[PROVIDER]
  assert.equal(provider.name, "Mine")
  assert.equal(provider.api, API_BASE)
  assert.equal(provider.models["mercury-3"].name, "Custom")
  assert.ok(provider.models["mercury-2"])
})

test("the sign-in method is one API key field that also takes playground", async () => {
  const { auth } = await hooks()
  assert.equal(auth.provider, PROVIDER)
  assert.deepEqual(auth.methods, [authMethod()])
  assert.equal(auth.methods[0].type, "api")
  assert.match(auth.methods[0].placeholder, /playground/)
})

test("the loader gives a key account the API and a playground account the playground", async () => {
  const { auth } = await hooks()

  const keyed = await auth.loader(async () => ({ type: "api", key: "  sk_test\n" }))
  assert.deepEqual(keyed, { baseURL: API_BASE, apiKey: "sk_test" })

  const playground = await auth.loader(async () => ({ type: "api", key: "playground" }))
  assert.equal(playground.baseURL, PLAYGROUND_BASE)
  assert.equal(typeof playground.fetch, "function")
  assert.equal(playground.apiKey, undefined)

  const none = await auth.loader(async () => undefined)
  assert.deepEqual(none, {})

  assert.equal(isPlaygroundAuth({ type: "api", key: " PlayGround " }), true)
  assert.equal(isPlaygroundAuth({ type: "api", key: "sk_test" }), false)
})

test("a playground account lists the playground's models without tools", async () => {
  const { provider } = await hooks()
  const models = await provider.models(
    {
      models: {
        "mercury-3": { id: "mercury-3", capabilities: { toolcall: true } },
      },
    },
    { auth: { type: "api", key: "playground" } },
  )
  assert.equal(models["mercury-3"].capabilities.toolcall, false)
  assert.equal(models["mercury-3"].free, true)
  assert.equal(models["mercury-2"].capabilities.toolcall, false)
})

test("a key account lists what Inception's API lists", async (t) => {
  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  const seen = []
  globalThis.fetch = async (url, init) => {
    seen.push({ url, authorization: new Headers(init.headers).get("authorization") })
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "mercury-3",
            name: "Inception: Mercury 3",
            context_length: 1000000,
            max_output_length: 131072,
            supported_endpoints: ["chat.completions"],
          },
        ],
      }),
    )
  }

  const { provider } = await hooks()
  const models = await provider.models({ models: {} }, { auth: { type: "api", key: "sk_test" } })
  assert.deepEqual(Object.keys(models), ["mercury-3"])
  assert.equal(models["mercury-3"].name, "Mercury 3")
  assert.equal(seen[0].url, `${API_BASE}/models`)
  assert.equal(seen[0].authorization, "Bearer sk_test")
})

test("a failed model list keeps the known one and says it fell back", async (t) => {
  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  globalThis.fetch = async () => new Response("down", { status: 503 })

  const { provider } = await hooks()
  const given = { "mercury-3": { id: "mercury-3" } }
  const models = await provider.models({ models: given }, { auth: { type: "api", key: "sk_test" } })
  assert.equal(models[Symbol.for("magpie.fellBack")], true)
  assert.ok(models["mercury-3"])
})