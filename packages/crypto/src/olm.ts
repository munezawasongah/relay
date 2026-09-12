import Olm = require("@matrix-org/olm/olm_legacy.js");

// Olm must be initialized exactly once before any class in it is used.
// Memoized so callers can call initCrypto() from multiple places (app
// startup, a lazy first-use guard, tests) without re-initializing.
let initPromise: Promise<void> | undefined;

export function initCrypto(): Promise<void> {
  if (!initPromise) {
    initPromise = Olm.init();
  }
  return initPromise;
}

export { Olm };
