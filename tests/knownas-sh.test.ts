// The skill's helper script against a fake knownAs API on localhost.
// Needs sh, curl and jq; skipped (not failed) where jq is missing.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../skill/knownas/scripts/knownas.sh", import.meta.url));

// Placeholders shaped like the real things, derived so no scanner reads them as credentials.
const KEY = ["aipk", "test", "fixture", "x".repeat(24)].join("_");
const SECRET = "s".repeat(43);
const TOKEN = "ab".repeat(16);
const ID = "aid_FIXTURE";

const hasJq = spawnSync("jq", ["--version"]).status === 0;

type Seen = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };
const seen: Seen[] = [];
let checks = 0;
let server: Server;
let base = "";
const work = mkdtempSync(join(tmpdir(), "knownas-sh-"));
const storeFile = join(work, "store.txt").replaceAll("\\", "/");
const storeScript = join(work, "store.mjs").replaceAll("\\", "/");

function send(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

const error = (code: string, message: string) => ({ error: { code, message, request_id: "req_x" } });
const route = (status = "pending") => ({
  service: "api", origin: "example-tunnel.trycloudflare.com", status, token: TOKEN,
  proof_url: "https://example-tunnel.trycloudflare.com/.well-known/knownas-origin", created_at: "t",
});

before(async () => {
  writeFileSync(
    storeScript,
    `import { appendFileSync, readFileSync } from "node:fs";\n` +
      `appendFileSync(${JSON.stringify(storeFile)}, process.argv.slice(2).join(" ") + "=" + readFileSync(0, "utf8") + "\\n");\n`,
  );
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      if (req.headers.authorization !== `Bearer ${KEY}`) return send(res, 401, error("AUTHENTICATION_REQUIRED", "no"));
      const url = req.url ?? "";
      if (req.method === "GET" && url === "/v1/me") return send(res, 200, { principal_type: "api_key", scopes: ["identity:create"], quota: { max_identities: 1 } });
      if (req.method === "POST" && url === "/v1/identities") {
        const slug = JSON.parse(body).slug;
        if (slug === "taken") return send(res, 409, error("IDENTITY_SLUG_UNAVAILABLE", "The requested identity slug is not available."));
        if (slug === "paypa1") return send(res, 422, { error: { code: "IDENTITY_SLUG_INVALID", message: "Not allocatable.", details: [{ field: "slug", message: "Too close to a protected name." }] } });
        return send(res, 202, { id: ID, slug, fqdn: `${slug}.knownas.dev`, status: "active", services: ["api", "webhooks"], endpoints: { manifest: `https://${slug}.knownas.dev/.well-known/agent-identity.json` } });
      }
      if (req.method === "GET" && url.startsWith("/v1/identities?")) return send(res, 200, { items: [{ id: ID, slug: "myclaw", status: "active" }], next_cursor: null });
      if (req.method === "GET" && url === `/v1/identities/${ID}`) return send(res, 200, { id: ID, fqdn: "myclaw.knownas.dev", status: "active", suspension_reason: null, endpoints: { manifest: "https://myclaw.knownas.dev/.well-known/agent-identity.json" } });
      if (req.method === "PUT" && url === `/v1/identities/${ID}/routes/api`) return send(res, 200, route());
      if (req.method === "POST" && url === `/v1/identities/${ID}/routes/api/check`) {
        checks += 1;
        if (checks === 2) return send(res, 429, error("RATE_LIMITED", "Too soon."));
        return send(res, 200, { passed: true, outcome: "ok", http_status: 200, origin_secret: checks === 1 ? SECRET : null, route: route("verified") });
      }
      if (req.method === "GET" && url === `/v1/identities/${ID}/routes`) return send(res, 200, { items: [route("verified"), { ...route("removed"), service: "mcp" }] });
      if (req.method === "GET" && url === `/v1/identities/${ID}/usage`) return send(res, 200, { window_days: 30, bytes_total: 1024, requests: 3, busiest_hour_bytes_24h: 512, limits: { warn_bytes_30d: 1, suspend_bytes_30d: 2, suspend_bytes_1h: 3 } });
      if (req.method === "DELETE" && url === `/v1/identities/${ID}/routes/api`) return send(res, 200, route("removed"));
      return send(res, 404, error("NOT_FOUND", "There is no endpoint at that path."));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server?.close());

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("sh", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, KNOWNAS_API_URL: base, KNOWNAS_API_KEY: KEY, KNOWNAS_SECRET_STORE_CMD: `node ${storeScript}`, ...env },
  });
  // Nothing the script prints may carry the key or the secret.
  for (const out of [result.stdout, result.stderr]) {
    assert.ok(!out.includes(KEY), "the key was printed");
    assert.ok(!out.includes(SECRET), "the secret was printed");
  }
  return { code: result.status, out: result.stdout, err: result.stderr, json: () => JSON.parse(result.stdout) };
}

const t = hasJq ? test : test.skip;

t("whoami sends the key as a bearer header and prints the scopes", () => {
  const r = run(["whoami"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json().scopes, ["identity:create"]);
});

t("refuses to run without a key", () => {
  const r = run(["whoami"], { KNOWNAS_API_KEY: "" });
  assert.equal(r.code, 2);
  assert.match(r.err, /KNOWNAS_API_KEY/);
});

t("refuses a plain-http API that is not localhost", () => {
  const r = run(["whoami"], { KNOWNAS_API_URL: "http://platform.knownas.dev" });
  assert.equal(r.code, 2);
});

t("create sends api and webhooks, the record, and an idempotency key derived from the request", () => {
  const record = join(work, "record.json");
  writeFileSync(record, JSON.stringify({ display_name: "My Claw", description: "A personal agent." }));
  const r = run(["create", "myclaw", "My Claw", record]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().fqdn, "myclaw.knownas.dev");
  const call = seen.filter((s) => s.method === "POST" && s.url === "/v1/identities").at(-1)!;
  const sent = JSON.parse(call.body);
  assert.deepEqual(sent.services, ["api", "webhooks"]);
  assert.equal(sent.manifest.display_name, "My Claw");
  assert.match(String(call.headers["idempotency-key"]), /^[0-9a-f]{32}$/);
  run(["create", "myclaw", "My Claw", record]);
  const again = seen.filter((s) => s.method === "POST" && s.url === "/v1/identities").at(-1)!;
  assert.equal(again.headers["idempotency-key"], call.headers["idempotency-key"], "a retry replays");
});

t("a taken name is exit 3 with the API's message", () => {
  const r = run(["create", "taken", "Taken"]);
  assert.equal(r.code, 3);
  assert.match(r.err, /IDENTITY_SLUG_UNAVAILABLE/);
});

t("a refused name is exit 4 with the reason", () => {
  const r = run(["create", "paypa1", "Paypal"]);
  assert.equal(r.code, 4);
  assert.match(r.err, /protected name/);
});

t("unknown services are refused before any call", () => {
  const before = seen.length;
  assert.equal(run(["create", "myclaw", "My Claw", "hooks"]).code, 2);
  assert.equal(seen.length, before);
});

t("find returns the id for a slug", () => {
  const r = run(["find", "myclaw"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim(), ID);
});

t("route sends the origin and prints the token", () => {
  const r = run(["route", ID, "api", "example-tunnel.trycloudflare.com"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().token, TOKEN);
  const call = seen.at(-1)!;
  assert.deepEqual(JSON.parse(call.body), { origin: "example-tunnel.trycloudflare.com" });
});

t("origins the platform refuses are refused locally, with no call", () => {
  for (const origin of ["127.0.0.1", "localhost", "my.local", "https://x.example.org", "x.example.org:8443", "x.example.org/path", "a.knownas.dev", "intranet"]) {
    const before = seen.length;
    assert.equal(run(["route", ID, "api", origin]).code, 6, origin);
    assert.equal(seen.length, before, origin);
  }
  assert.equal(run(["origin-ok", "abc.trycloudflare.com"]).code, 0);
});

t("the first passing check stores the secret without printing it; a later one stores nothing", () => {
  const r = run(["check", ID, "api"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json(), { passed: true, outcome: "ok", http_status: 200, status: "verified", secret_stored: true });
  const store = readFileSync(storeFile, "utf8");
  assert.equal(store, `KNOWNAS_ORIGIN_SECRET_API --kind secret=${SECRET}\n`);
  const tooSoon = run(["check", ID, "api"]);
  assert.equal(tooSoon.code, 5);
  assert.match(tooSoon.err, /wait a minute/);
  const later = run(["check", ID, "api"]);
  assert.equal(later.json().secret_stored, false);
  assert.equal(readFileSync(storeFile, "utf8"), store, "nothing new stored");
});

t("status joins identity, live routes and traffic", () => {
  const r = run(["status", ID]);
  assert.equal(r.code, 0, r.err);
  const s = r.json();
  assert.equal(s.fqdn, "myclaw.knownas.dev");
  assert.deepEqual(s.routes.map((x: { service: string }) => x.service), ["api"], "removed routes are left out");
  assert.equal(s.traffic.bytes_total, 1024);
  assert.equal(s.traffic.limits.suspend_bytes_30d, 2);
});

t("remove-route deletes the route", () => {
  const r = run(["remove-route", ID, "api"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().status, "removed");
  assert.equal(seen.at(-1)!.method, "DELETE");
});

test("the key never reaches a process listing", () => {
  // Static: the key is only ever written by printf (a builtin) into curl's stdin config.
  const source = readFileSync(SCRIPT, "utf8");
  const uses = source.split("\n").filter((l) => l.includes("KNOWNAS_API_KEY") && !l.trimStart().startsWith("#"));
  for (const line of uses) {
    assert.ok(/printf|\[ -n|die|need_key/.test(line), `unexpected use: ${line.trim()}`);
  }
  assert.ok(!/curl[^\n]*KNOWNAS_API_KEY/.test(source));
});

test("the script never archives, deletes an identity or creates an account", () => {
  const source = readFileSync(SCRIPT, "utf8");
  assert.ok(!/\/archive|DELETE "\/v1\/identities\/\$1"[^/]|\/v1\/auth|\/v1\/api-keys|\/v1\/waitlist/.test(source));
});

test("the script is valid POSIX sh", () => {
  execFileSync("sh", ["-n", SCRIPT]);
});
