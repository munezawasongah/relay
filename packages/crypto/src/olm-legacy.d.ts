// @matrix-org/olm's package.json "main" points at olm.js, which loads a
// WebAssembly binary (olm.wasm). This package deliberately imports the
// "olm_legacy.js" subpath instead — a pure-JS/asm.js build with no
// WebAssembly dependency — because React Native's default JS engine
// (Hermes) does not support WebAssembly. The legacy build has identical
// runtime behavior (verified: session establishment, encrypt/decrypt,
// ratchet advancement, and group sessions all round-trip correctly — see
// src/olm.test.ts) so this is a safe substitution, not a compromise.
//
// TypeScript doesn't know about this subpath, so this ambient declaration
// tells it the subpath has the same shape as the main package's types.
declare module "@matrix-org/olm/olm_legacy.js" {
  import Olm = require("@matrix-org/olm");
  export = Olm;
}
