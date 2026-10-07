// The proof route without a gateway: a fake request and response through the
// same handler the plugin registers. Run with `npm test` in plugin/.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { test } from "node:test";

import { createProofHandler, MAX_TOKENS, PROOF_PATH, readTokens } from "../plugin/src/proof.ts";

// Shaped like a platform token (32 hex), derived so nothing here looks like a credential.
const tokenFor = (n: number): string => n.toString(16).padStart(2, "0").repeat(16);
const API = tokenFor(10);
const WEBHOOKS = tokenFor(11);

type Sent = { status: number; headers: Record<string, string>; body: string };

function call(tokens: readonly string[], method = "GET"): Sent {
  const headers: Record<string, string> = {};
  const sent: Sent = { status: 0, headers, body: "" };
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(chunk?: string) {
      sent.status = this.statusCode;
      sent.body = chunk ?? "";
    },
  };
  const handled = createProofHandler(tokens)({ method } as IncomingMessage, res as unknown as ServerResponse);
  assert.equal(handled, true, "the route always answers; it never falls through");
  return sent;
}

test("the path is the one the platform fetches", () => {
  assert.equal(PROOF_PATH, "/.well-known/knownas-origin");
});

test("serves every token on a line of its own, as text, never cached", () => {
  const sent = call([API, WEBHOOKS]);
  assert.equal(sent.status, 200);
  assert.equal(sent.body, `${API}\n${WEBHOOKS}\n`);
  assert.equal(sent.headers["content-type"], "text/plain; charset=utf-8");
  assert.equal(sent.headers["cache-control"], "no-store");
  assert.equal(sent.headers["content-length"], String(sent.body.length));
});

test("the platform's line rule finds each token", () => {
  // The platform's proof_matches: some line, stripped, equals the token.
  const lines = call([API, WEBHOOKS]).body.split(/\r?\n/).map((l) => l.trim());
  assert.ok(lines.includes(API));
  assert.ok(lines.includes(WEBHOOKS));
});

test("no token configured is a 404, never an empty 200", () => {
  const sent = call([]);
  assert.equal(sent.status, 404);
  assert.equal(sent.headers["cache-control"], "no-store");
  assert.ok(!sent.body.includes(API));
});

test("HEAD answers like GET without a body", () => {
  const sent = call([API], "HEAD");
  assert.equal(sent.status, 200);
  assert.equal(sent.body, "");
  assert.equal(sent.headers["content-length"], String(API.length + 1));
});

test("other methods are refused", () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const sent = call([API], method);
    assert.equal(sent.status, 405, method);
    assert.equal(sent.headers.allow, "GET, HEAD");
    assert.equal(sent.body, "");
  }
});

test("only token-shaped values are served", () => {
  const tokens = readTokens({
    originTokens: [API, "<script>", API.toUpperCase(), `${API}\nextra`, 42, null, WEBHOOKS, API],
  });
  assert.deepEqual(tokens, [API, WEBHOOKS]);
});

test("a missing or malformed setting serves nothing", () => {
  assert.deepEqual(readTokens(undefined), []);
  assert.deepEqual(readTokens({}), []);
  assert.deepEqual(readTokens({ originTokens: API }), []);
});

test("at most MAX_TOKENS tokens", () => {
  const many = Array.from({ length: MAX_TOKENS + 3 }, (_, i) => tokenFor(i + 1));
  assert.equal(readTokens({ originTokens: many }).length, MAX_TOKENS);
});

test("the manifest's schema and the code agree", () => {
  const manifest = JSON.parse(readFileSync(new URL("../plugin/openclaw.plugin.json", import.meta.url), "utf8"));
  assert.equal(manifest.id, "knownas");
  const schema = manifest.configSchema.properties.originTokens;
  assert.equal(schema.maxItems, MAX_TOKENS);
  assert.equal(schema.items.pattern, "^[0-9a-f]{32}$");
  assert.equal(manifest.configSchema.additionalProperties, false);
});

test("the plugin makes no outbound calls", () => {
  for (const file of ["../plugin/index.ts", "../plugin/src/proof.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const banned of ["fetch(", "node:https", "node:net", "request(", "process.env"]) {
      assert.ok(!source.includes(banned), `${file} uses ${banned}`);
    }
  }
});
