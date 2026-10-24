// Signing in: one API key field. A key is used against Inception's
// OpenAI-compatible API; the word "playground" instead of a key uses the
// public endpoint behind Inception's own playground.

import { API_BASE, PLAYGROUND_BASE, PLAYGROUND_KEY } from "./catalog.mjs"
import { KEYS_INPUT, KEYS_REQUIRED, keyImporter, parseAPIKeys } from "./accounts.mjs"
import { playgroundFetch } from "./playground.mjs"

export function authMethod(input) {
  const label = "Inception API keys (or playground)"
  const placeholder = "sk_… — separate keys with commas or spaces, or type playground"
  const importKeys = keyImporter(input)
  return {
    type: "api",
    label,
    placeholder,
    // The password prompt supplies the credentials to authorize. Magpie
    // skips its default key field, leaving one input for a single or a batch.
    keyless: true,
    prompts: [
      {
        type: "password",
        key: KEYS_INPUT,
        message: label,
        placeholder,
        validate: (value) => (parseAPIKeys(value).length ? undefined : KEYS_REQUIRED),
      },
    ],
    authorize: async (inputs = {}) => importKeys(inputs[KEYS_INPUT]),
  }
}

// isPlaygroundAuth says whether an account was signed in with "playground"
// rather than a key.
export function isPlaygroundAuth(auth) {
  return (
    auth?.type === "api" &&
    typeof auth.key === "string" &&
    auth.key.trim().toLowerCase() === PLAYGROUND_KEY
  )
}

// loader gives each account its base URL and, for the playground, the fetch
// that adapts its requests.
export async function loader(getAuth) {
  const auth = await getAuth()
  if (!auth || auth.type !== "api" || typeof auth.key !== "string") return {}
  if (isPlaygroundAuth(auth)) {
    return { baseURL: PLAYGROUND_BASE, fetch: playgroundFetch }
  }
  // what the user pasted, without the whitespace a terminal adds
  return { baseURL: API_BASE, apiKey: auth.key.trim() }
}
