// Firefox exposes `browser` (promise-based); Chrome exposes `chrome` (promises in MV3).
// Uses `var` because this file is injected by more than one content_scripts entry
// into the same page, and `const` redeclaration would throw.
var ext = globalThis.browser ?? globalThis.chrome;

var DEFAULTS = { darkMode: false, panel: true };

async function getSettings() {
  return { ...DEFAULTS, ...(await ext.storage.local.get(Object.keys(DEFAULTS))) };
}
