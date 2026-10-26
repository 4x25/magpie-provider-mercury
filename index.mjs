// Magpie provider plugin: Inception Labs Mercury.
//
// Sign in with an Inception API key, or type "playground" to use the free
// endpoint behind Inception's own playground.

import { MercuryPlugin } from "./src/plugin.mjs"
import * as accounts from "./src/accounts.mjs"
import * as auth from "./src/auth.mjs"
import * as catalog from "./src/catalog.mjs"
import * as models from "./src/models.mjs"
import * as playground from "./src/playground.mjs"
import * as reasoning from "./src/reasoning.mjs"

export default MercuryPlugin

// The pieces the tests use; not a hook Magpie calls.
export const _internal = { ...accounts, ...auth, ...catalog, ...models, ...playground, ...reasoning }
