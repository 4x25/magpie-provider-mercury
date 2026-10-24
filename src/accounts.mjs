// Import each credential as a native Magpie account. Existing slots and
// identities are preserved so repeated imports keep account settings.

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"

import { PLAYGROUND_KEY, PROVIDER } from "./catalog.mjs"

export const KEYS_INPUT = "apiKeys"
export const KEYS_REQUIRED = "Enter an Inception API key or playground."

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)

function normalizeKey(value) {
  const key = value.trim()
  return key.toLowerCase() === PLAYGROUND_KEY ? PLAYGROUND_KEY : key
}

export function parseAPIKeys(value) {
  if (typeof value !== "string") return []
  return [...new Set(value.split(/[,\s]+/u).map(normalizeKey).filter(Boolean))]
}

export function accountID(key) {
  return `${PROVIDER}#mercury-${createHash("sha256").update(normalizeKey(key)).digest("hex")}`
}

function readSignIns(directory) {
  if (typeof directory !== "string" || !isAbsolute(directory)) {
    throw new Error("Magpie did not supply its configuration directory.")
  }
  const file = join(directory, "plugin-auth.json")
  let text
  try {
    text = readFileSync(file, "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return {}
    throw new Error("Could not read Magpie's saved sign-ins. No keys were imported.")
  }
  const parse = (text) => {
    try {
      const value = JSON.parse(text)
      return isObject(value) ? value : null
    } catch {
      return null
    }
  }
  const all = parse(text)
  if (all) return all
  // Magpie can recover a damaged credential file from its last good backup.
  try {
    const backup = parse(readFileSync(file + ".bak", "utf8"))
    if (backup) return backup
  } catch {
    /* an unreadable backup is not an empty account list */
  }
  throw new Error("Magpie's saved sign-ins could not be parsed. No keys were imported.")
}

function apiKeyOf(auth) {
  return auth?.type === "api" && typeof auth.key === "string" ? normalizeKey(auth.key) : ""
}

function whoOf(auth) {
  return auth?.accountId ?? auth?.metadata?.email ?? auth?.email ?? ""
}

function newAuth(key, all) {
  const hash = accountID(key).split("mercury-")[1]
  const label = key === PLAYGROUND_KEY ? "Mercury Playground" : key.length >= 12 ? `API key …${key.slice(-4)}` : "API key"
  const names = new Set(Object.values(all).map(whoOf).filter((v) => typeof v === "string").map((v) => v.toLowerCase()))
  for (let n = 12; n <= hash.length; n += 4) {
    const accountId = `${label} (${hash.slice(0, n)})`
    if (!names.has(accountId.toLowerCase())) return { type: "api", key, accountId }
  }
  throw new Error("A Mercury account name is already in use. No keys were imported.")
}

function cleanAuth(auth) {
  const out = { ...auth }
  if (isObject(out.metadata)) {
    out.metadata = { ...out.metadata }
    delete out.metadata[KEYS_INPUT]
    if (!Object.keys(out.metadata).length) delete out.metadata
  }
  return out
}

export function keyImporter(input = {}) {
  const importKeys = async (value) => {
    const keys = parseAPIKeys(value)
    if (!keys.length) return { type: "failed", error: KEYS_REQUIRED }

    if (!input.magpie) {
      return keys.length === 1
        ? { type: "success", key: keys[0], metadata: { [KEYS_INPUT]: undefined } }
        : { type: "failed", error: "Importing multiple API keys requires Magpie's plugin host." }
    }

    let all
    try {
      all = readSignIns(input.directory)
    } catch (error) {
      return { type: "failed", error: error.message }
    }
    if (typeof input.client?.auth?.set !== "function") {
      return { type: "failed", error: "Magpie did not supply its credential storage client." }
    }

    const existing = new Map()
    const accounts = Object.entries(all)
      .filter(([id]) => id === PROVIDER || id.startsWith(PROVIDER + "#"))
      .sort(([a], [b]) => (a === PROVIDER ? -1 : b === PROVIDER ? 1 : a.localeCompare(b)))
    for (const [id, auth] of accounts) {
      const key = apiKeyOf(auth)
      if (key && !existing.has(key)) existing.set(key, { id, auth })
    }

    const firstSaved = existing.get(keys[0])
    const firstAuth = cleanAuth(firstSaved?.auth ?? newAuth(keys[0], all))
    const uidOf = (auth) => typeof auth?.uid === "string" ? auth.uid : ""
    const who = whoOf(firstAuth)
    if (who && accounts.some(([id, auth]) => id !== firstSaved?.id && whoOf(auth) === who &&
      !(uidOf(firstAuth) && uidOf(auth) && uidOf(firstAuth) !== uidOf(auth)))) {
      return { type: "failed", error: "These saved Inception accounts share an ambiguous identity. No keys were imported." }
    }

    const writes = []
    try {
      // The first credential is written into the account Magpie reserved for
      // this login. Its normal settle step then reuses an existing matching
      // account or keeps this new native slot, and clears its lapse marker.
      writes.push({ id: PROVIDER, auth: firstAuth })
      for (const key of keys.slice(1)) {
        if (existing.has(key)) continue
        const id = accountID(key)
        if (Object.hasOwn(all, id)) {
          throw new Error("A Mercury account identifier is already in use. No keys were imported.")
        }
        const auth = newAuth(key, all)
        all[id] = auth
        existing.set(key, { id, auth })
        writes.push({ id, auth })
      }
    } catch (error) {
      return { type: "failed", error: error.message }
    }

    try {
      // Save additional accounts first. If a later write fails, retrying the
      // same input recognizes every successful key and creates no duplicate.
      for (const { id, auth } of writes.slice(1)) {
        const result = await input.client.auth.set({ path: { id }, body: auth })
        if (result?.error) throw new Error("credential storage failed")
      }
      const result = await input.client.auth.set({ path: { id: PROVIDER }, body: firstAuth })
      if (result?.error) throw new Error("credential storage failed")
    } catch {
      return { type: "failed", error: "Could not save all API keys. Retry the same input to keep any keys already imported." }
    }
    // Credentials are already stored. Returning no key keeps the full auth
    // object intact while the host settles the first account normally.
    return { type: "success" }
  }

  // Imports in one host are serialized; Magpie serializes the credential
  // file writes themselves.
  let pending = Promise.resolve()
  return (value) => {
    const result = pending.then(() => importKeys(value))
    pending = result.catch(() => {})
    return result
  }
}
