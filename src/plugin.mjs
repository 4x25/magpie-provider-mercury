// The plugin Magpie loads: the Inception provider, its sign-in, and each
// account's model list.

import { API_BASE, PROVIDER, SDK } from "./catalog.mjs"
import { authMethod, isPlaygroundAuth, loader } from "./auth.mjs"
import {
  configModels,
  discoverModels,
  fallbackModels,
  playgroundModels,
} from "./models.mjs"

export async function MercuryPlugin(input) {
  const log = async (level, message) => {
    try {
      await input?.client?.app?.log({
        body: { service: "magpie-provider-mercury", level, message },
      })
    } catch {
      /* logging is best effort */
    }
  }

  return {
    // The provider as OpenCode and Magpie see it before anyone signs in.
    // A user's own provider entry is kept as it is: only what it lacks is
    // filled in.
    config: async (cfg) => {
      cfg.provider ??= {}
      const provider = (cfg.provider[PROVIDER] ??= {})
      provider.name ??= "Inception (Mercury)"
      provider.npm ??= SDK
      provider.api ??= API_BASE
      provider.models ??= {}
      for (const [id, model] of Object.entries(configModels())) {
        provider.models[id] ??= model
      }
    },

    auth: {
      provider: PROVIDER,
      methods: [authMethod(input)],
      loader,
    },

    // Each account's models: a key account asks Inception's list, a
    // playground account gets the playground's few (without tools).
    provider: {
      id: PROVIDER,
      async models(provider, { auth } = {}) {
        if (isPlaygroundAuth(auth)) return playgroundModels(provider?.models)
        try {
          const models = await discoverModels(auth?.key)
          if (Object.keys(models).length) return models
          throw new Error("Inception's model list was empty")
        } catch (e) {
          await log("warn", `couldn't read Inception's model list: ${e?.message ?? e}; keeping the list already known`)
          return fallbackModels(provider?.models)
        }
      },
    },
  }
}
