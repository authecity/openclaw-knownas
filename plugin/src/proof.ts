import type { IncomingMessage, ServerResponse } from "node:http";

/** Where knownAs.dev looks for the proof that you control this origin. */
export const PROOF_PATH = "/.well-known/knownas-origin";

/**
 * A route token as the platform issues it: 32 lowercase hex characters.
 * Anything else in the configuration is refused rather than served, so a
 * typo cannot publish arbitrary text at a well-known path.
 */
const TOKEN = /^[0-9a-f]{32}$/;

/** At most one token per service (`api`, `mcp`, `webhooks`), with room to re-point. */
export const MAX_TOKENS = 6;

export type KnownasPluginConfig = {
  originTokens?: unknown;
};

/** The configured tokens that look like tokens, deduplicated, in order. */
export function readTokens(config: KnownasPluginConfig | undefined): string[] {
  const raw = config?.originTokens;
  if (!Array.isArray(raw)) {
    return [];
  }
  const tokens: string[] = [];
  for (let i = 0; i < raw.length && tokens.length < MAX_TOKENS; i++) {
    const value = raw[i];
    if (typeof value === "string" && TOKEN.test(value) && !tokens.includes(value)) {
      tokens.push(value);
    }
  }
  return tokens;
}

/**
 * Serves the proof document: one token per line, `text/plain`, never cached.
 *
 * - No token configured: 404, never an empty 200, so a half-finished setup
 *   reads as "not there" to the platform's check.
 * - GET and HEAD only; anything else is 405.
 * - The platform's check follows no redirect, so this answers directly.
 */
export function createProofHandler(
  tokens: readonly string[],
): (req: IncomingMessage, res: ServerResponse) => boolean {
  const body = tokens.length > 0 ? `${tokens.join("\n")}\n` : "";
  return (req, res) => {
    const method = (req.method ?? "GET").toUpperCase();
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    if (method !== "GET" && method !== "HEAD") {
      res.statusCode = 405;
      res.setHeader("allow", "GET, HEAD");
      res.end();
      return true;
    }
    if (body === "") {
      res.statusCode = 404;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(method === "HEAD" ? undefined : "No knownAs origin token is configured.\n");
      return true;
    }
    res.statusCode = 200;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("content-length", String(Buffer.byteLength(body)));
    res.end(method === "HEAD" ? undefined : body);
    return true;
  };
}
