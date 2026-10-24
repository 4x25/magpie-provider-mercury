import assert from "node:assert/strict"
import { AsyncLocalStorage } from "node:async_hooks"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import plugin, { _internal } from "../index.mjs"

const { accountID, KEYS_INPUT, KEYS_REQUIRED, keyImporter, parseAPIKeys, PROVIDER } = _internal

const A = "sk_example_A1111"
const B = "sk_example_B2222"
const C = "sk_example_C3333"

function magpie(t, initial = {}, storage = {}) {
  const directory = mkdtempSync(join(tmpdir(), "mercury-accounts-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const file = join(directory, "plugin-auth.json")
  const read = () => JSON.parse(readFileSync(file, "utf8"))
  const recovered = () => {
    try {
      return read()
    } catch {
      return JSON.parse(readFileSync(file + ".bak", "utf8"))
    }
  }
  const write = (all) => writeFileSync(file, JSON.stringify(all), { mode: 0o600 })
  write(initial)
  const calls = []
  const scope = new AsyncLocalStorage()
  let next = 0
  const input = {
    directory,
    magpie: {},
    client: {
      auth: {
        async set({ path: { id }, body }) {
          if (storage.beforeSet) await storage.beforeSet(id, body, calls.length)
          if (id === PROVIDER) id = scope.getStore() ?? PROVIDER
          const all = recovered()
          all[id] = body
          write(all)
          calls.push({ id, body: structuredClone(body) })
          return { data: true }
        },
      },
    },
  }
  const finish = (result, temporary) => {
    assert.equal(result.type, "success")
    const all = read()
    const now = all[temporary]
    if (!now) return temporary
    const whoOf = (auth) => auth.accountId ?? auth.metadata?.email ?? auth.email ?? ""
    const who = whoOf(now)
    for (const id of Object.keys(all).filter((id) => id === PROVIDER || id.startsWith(PROVIDER + "#")).sort()) {
      if (id === temporary) continue
      const was = all[id]
      const other = now.uid && was.uid && now.uid !== was.uid
      if ((who && whoOf(was) === who && !other) || (!who && !whoOf(was) && now.key && was.key === now.key)) {
        all[id] = now
        delete all[temporary]
        write(all)
        return id
      }
    }
    write(all)
    return temporary
  }
  const importer = keyImporter(input)
  const authorize = async (value, custom = importer) => {
    const all = read()
    const temporary = Object.hasOwn(all, PROVIDER) ? `${PROVIDER}#sign-in-${next++}` : PROVIDER
    const result = await scope.run(temporary, () => custom(value))
    return { result, temporary }
  }
  const login = async (value, custom = importer) => {
    const { result, temporary } = await authorize(value, custom)
    return { result, kept: result.type === "success" ? finish(result, temporary) : undefined }
  }
  return { input, file, read, write, calls, authorize, login }
}

test("API key parsing trims and deduplicates comma and space separated values", () => {
  assert.deepEqual(parseAPIKeys(`  ${A}, ${B} ${A} ,, ${C} , `), [A, B, C])
  assert.deepEqual(parseAPIKeys(`${A}\t${B}\r\n${A}`), [A, B])
  assert.deepEqual(parseAPIKeys(" , , "), [])
  assert.deepEqual(parseAPIKeys(undefined), [])
})

test("API key parsing preserves credential case and punctuation", () => {
  assert.deepEqual(parseAPIKeys(`${A},${A.toLowerCase()}`), [A, A.toLowerCase()])
  assert.deepEqual(parseAPIKeys(`${A}.${B}`), [`${A}.${B}`])
  assert.deepEqual(parseAPIKeys(`${A};${B}`), [`${A};${B}`])
})

test("playground is normalized and deduplicated without changing API key case", () => {
  assert.deepEqual(parseAPIKeys(` PlayGround, ${A} PLAYGROUND playground `), ["playground", A])
  assert.equal(accountID(" PLAYGROUND "), accountID("playground"))
})

test("account identifiers are stable fingerprints rather than exposed credentials", () => {
  assert.equal(accountID(` ${A} `), accountID(A))
  assert.match(accountID(A), /^inception#mercury-[a-f0-9]{64}$/)
  assert.equal(accountID(A).includes(A), false)
  assert.notEqual(accountID(A), accountID(B))
})

test("a batch creates one native account per key and keeps unrelated sign-ins", async (t) => {
  const unrelated = { type: "api", key: "other-provider-fixture" }
  const host = magpie(t, { other: unrelated })
  const hooks = await plugin(host.input)
  const value = `  ${A}, ${B} ${A} ,, `
  const { result, kept } = await host.login(value, (input) => hooks.auth.methods[0].authorize({ [KEYS_INPUT]: input }))
  assert.deepEqual(result, { type: "success" })
  assert.equal(kept, PROVIDER)
  assert.deepEqual(host.calls.map(({ body }) => body.key), [B, A])
  const all = host.read()
  assert.deepEqual(Object.keys(all).sort(), ["other", PROVIDER, accountID(B)].sort())
  assert.deepEqual(all.other, unrelated)
  assert.equal(all[PROVIDER].key, A)
  assert.equal(all[accountID(B)].key, B)
  assert.equal(JSON.stringify(all).includes(value), false)
})

test("repeated and overlapping imports reuse accounts across plugin instances", async (t) => {
  const host = magpie(t)
  await host.login(`${A},${B}`)
  const ids = Object.keys(host.read()).sort()
  host.calls.length = 0
  assert.equal((await host.login(`${B}, ${A}, ${B}`)).kept, accountID(B))
  assert.deepEqual(Object.keys(host.read()).sort(), ids)
  assert.equal(host.read()[PROVIDER].key, A)
  host.calls.length = 0
  assert.equal((await host.login(`${B},${C}`, keyImporter(host.input))).kept, accountID(B))
  assert.deepEqual([...new Set(host.calls.map(({ body }) => body.key))], [C, B])
  assert.equal(Object.keys(host.read()).length, 3)
})

test("legacy accounts keep slots, identity and metadata when imported again", async (t) => {
  const legacy = `${PROVIDER}#legacy`
  const auth = { type: "api", key: B, metadata: { email: "legacy@example.invalid", custom: { keep: true } }, uid: "vendor-B" }
  const host = magpie(t, { [PROVIDER]: { type: "api", key: A }, [legacy]: auth })
  const { kept } = await host.login(`${B},${A},${C}`)
  assert.equal(kept, legacy)
  assert.deepEqual(host.read()[legacy], auth)
  assert.equal(host.read()[PROVIDER].key, A)
  assert.equal(host.read()[accountID(C)].key, C)
})

test("legacy whitespace is matched without creating a second account", async (t) => {
  const host = magpie(t, { [PROVIDER]: { type: "api", key: `  ${A}\n` } })
  assert.equal((await host.login(`${A},${B}`)).kept, PROVIDER)
  assert.equal(Object.keys(host.read()).length, 2)
  assert.equal(host.read()[PROVIDER].key.trim(), A)
})

test("accounts sharing an identity retain distinct keys when vendor ids differ", async (t) => {
  const first = { type: "api", key: A, metadata: { email: "same@example.invalid" }, uid: "vendor-A" }
  const second = { type: "api", key: B, metadata: { email: "same@example.invalid" }, uid: "vendor-B" }
  const host = magpie(t, { [PROVIDER]: first, [`${PROVIDER}#legacy`]: second })
  assert.equal((await host.login(`${B},${A}`)).kept, `${PROVIDER}#legacy`)
  assert.deepEqual(host.read()[PROVIDER], first)
  assert.deepEqual(host.read()[`${PROVIDER}#legacy`], second)
})

test("an ambiguous legacy identity is rejected before storage changes", async (t) => {
  const initial = {
    [PROVIDER]: { type: "api", key: A, accountId: "same@example.invalid" },
    [`${PROVIDER}#other`]: { type: "api", key: B, accountId: "same@example.invalid" },
  }
  const host = magpie(t, initial)
  const before = readFileSync(host.file, "utf8")
  const { result } = await host.login(`${B},${C}`)
  assert.equal(result.type, "failed")
  assert.match(result.error, /ambiguous identity/)
  assert.equal(host.calls.length, 0)
  assert.equal(readFileSync(host.file, "utf8"), before)
})

test("new account names remain stable when key suffixes are identical", async (t) => {
  const host = magpie(t)
  const other = "sk_other_A1111"
  await host.login(A)
  const firstID = host.read()[PROVIDER].accountId
  await host.login(other)
  const names = Object.values(host.read()).map(({ accountId }) => accountId)
  assert.equal(host.read()[PROVIDER].accountId, firstID)
  assert.equal(new Set(names).size, 2)
  assert.ok(names.every((name) => name.includes("…1111 (") && !name.includes(A)))
})

test("an interrupted completion leaves one usable account and retry adds no duplicate", async (t) => {
  const host = magpie(t)
  // Authorize in the base account but skip the host's finish/settle step.
  const auth = await host.authorize(A)
  assert.equal(auth.result.type, "success")
  assert.equal(Object.keys(host.read()).length, 1)
  assert.equal((await host.login(A)).kept, PROVIDER)
  assert.equal(Object.keys(host.read()).length, 1)
})

test("playground remains one native account across spelling variants", async (t) => {
  const host = magpie(t)
  await host.login(` PlayGround, ${A}, PLAYGROUND `)
  const before = Object.keys(host.read()).sort()
  assert.equal((await host.login(" PLAYGROUND ")).kept, PROVIDER)
  assert.deepEqual(Object.keys(host.read()).sort(), before)
  const options = (await plugin(host.input)).auth.loader(async () => host.read()[PROVIDER])
  assert.equal(typeof (await options).fetch, "function")
})

test("empty input and missing host capabilities fail without writes", async (t) => {
  assert.deepEqual(await keyImporter({ magpie: {}, directory: "/not-used" })(" , , "), { type: "failed", error: KEYS_REQUIRED })
  for (const directory of [undefined, "relative-config"]) {
    assert.match((await keyImporter({ magpie: {}, directory })(A)).error, /configuration directory/)
  }
  const host = magpie(t)
  host.input.client = {}
  assert.match((await keyImporter(host.input)(A)).error, /credential storage client/)
  assert.deepEqual(host.read(), {})
})

test("single-key sign-in outside Magpie remains supported", async () => {
  const importer = keyImporter()
  assert.equal((await importer(` ${A} `)).key, A)
  assert.equal((await importer("PLAYGROUND")).key, "playground")
  assert.match((await importer(`${A},${B}`)).error, /requires Magpie/)
})

test("missing credential files are treated as a new installation", async (t) => {
  const host = magpie(t)
  rmSync(host.file)
  host.input.client.auth.set = async ({ path: { id }, body }) => {
    const all = (() => { try { return host.read() } catch { return {} } })()
    all[id] = body
    host.write(all)
    return { data: true }
  }
  assert.equal((await keyImporter(host.input)(A)).type, "success")
  assert.equal(Object.values(host.read())[0].key, A)
})

test("an unreadable or malformed credential store is not overwritten", async (t) => {
  for (const content of ["broken JSON", "[]", "null", ""]) {
    const host = magpie(t)
    writeFileSync(host.file, content)
    assert.equal((await keyImporter(host.input)(A)).type, "failed")
    assert.equal(host.calls.length, 0)
    assert.equal(readFileSync(host.file, "utf8"), content)
  }
  const host = magpie(t)
  rmSync(host.file)
  mkdirSync(host.file)
  assert.equal((await keyImporter(host.input)(A)).type, "failed")
})

test("Magpie's last good backup is used for duplicate matching", async (t) => {
  const host = magpie(t, { [PROVIDER]: { type: "api", key: A } })
  writeFileSync(host.file + ".bak", readFileSync(host.file))
  writeFileSync(host.file, "broken JSON")
  const result = await keyImporter(host.input)(A)
  assert.equal(result.type, "success")
  assert.equal(host.calls.at(-1).body.key, A)
})

test("an occupied additional-account fingerprint fails before writes", async (t) => {
  const host = magpie(t, { [accountID(B)]: { type: "oauth", access: "other-fixture" } })
  const before = readFileSync(host.file, "utf8")
  const result = await keyImporter(host.input)(`${A},${B}`)
  assert.equal(result.type, "failed")
  assert.equal(host.calls.length, 0)
  assert.equal(readFileSync(host.file, "utf8"), before)
})

test("storage failures expose no keys and retries finish a partial import", async (t) => {
  let fail = true
  const host = magpie(t, {}, { beforeSet: async (_id, body) => {
    if (fail && body.key === A) throw new Error(`private failure: ${A}`)
  } })
  const first = await host.login(`${A},${B}`)
  assert.equal(first.result.type, "failed")
  assert.equal(first.result.error.includes(A), false)
  assert.equal(Object.values(host.read())[0].key, B)
  fail = false
  assert.equal((await host.login(`${A},${B}`)).result.type, "success")
  assert.equal(new Set(Object.values(host.read()).map(({ key }) => key)).size, 2)
})
