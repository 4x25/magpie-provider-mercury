// Signing in: one API key field. A key is used against Inception's
// OpenAI-compatible API; the word "playground" instead of a key uses the
// public endpoint behind Inception's own playground.

import { API_BASE, PLAYGROUND_BASE, PLAYGROUND_KEY } from "./catalog.mjs"
import { playgroundFetch } from "./playground.mjs"

export function authMethod() {
  return {
    type: "api",
    label: "Inception API key (or playground)",
    placeholder: "sk_… — or type playground to use the Mercury playground",
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