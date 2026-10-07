import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createProofHandler, PROOF_PATH, readTokens } from "./src/proof.js";

/**
 * knownAs.dev for OpenClaw: serves the origin proof token, and nothing else.
 *
 * One unauthenticated route, because knownAs.dev's check fetches it without
 * credentials. No outbound calls and no API key: the `knownas` skill talks to
 * the API; this plugin only answers at `/.well-known/knownas-origin`.
 *
 * There is deliberately no `x-knownas-origin-secret` check. A plugin cannot
 * guard routes it does not own (exact routes match before prefix routes, and
 * routes at different auth levels may not overlap), and the only route this
 * plugin owns has to stay open. See the README.
 */
export default definePluginEntry({
  id: "knownas",
  name: "knownAs.dev",
  description: "Serves the knownAs.dev origin proof token so this gateway can be given a stable public name.",
  register(api) {
    const tokens = readTokens(api.pluginConfig);
    api.registerHttpRoute({
      path: PROOF_PATH,
      auth: "plugin",
      match: "exact",
      handler: createProofHandler(tokens),
    });
  },
});
