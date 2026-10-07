# knownAs.dev for OpenClaw

A stable public name for your OpenClaw gateway: **`myclaw.knownas.dev`**, with
HTTPS, a public record of who runs it, and webhook and API addresses that
keep working when the tunnel behind them changes.

```text
https://myclaw.knownas.dev/.well-known/agent-identity.json   who runs it, and whether it is in good standing
https://myclaw.api.knownas.dev                               the gateway (A2A, its OpenAI-compatible API)
https://myclaw.hooks.knownas.dev/<path>                      channel webhooks, path unchanged
```

A gateway on a laptop or a home server reaches the world through a tunnel or
Tailscale Funnel, and a quick tunnel gets a new URL every time it restarts.
Every channel that delivers webhooks to the old URL then goes silent. With a
knownAs name, the channels point at the name; after a restart, one command
re-points the name and nothing else changes.

## What is here

| Path | What |
|---|---|
| [`skill/knownas/`](skill/knownas/) | The `knownas` skill: `/knownas setup`, `repoint`, `channels`, `status`, `remove` |
| [`plugin/`](plugin/) | The `knownas` plugin: serves the proof token at `/.well-known/knownas-origin` |
| [`tests/`](tests/) | The plugin's route and the skill's helper, tested without a gateway |

Licensed under [Apache-2.0](LICENSE).

## Before you start

1. **A person gets the account.** knownAs is in a private beta: join the
   waitlist at [knownas.dev](https://knownas.dev), accept the invitation,
   sign in. The skill never signs anyone up.
2. **Mint a narrow key** in the console, under API keys: `identity:create`,
   `identity:read`, `manifest:write` and `route:write`, with an expiry.
3. **Give it to the skill, not to the chat.** Store it in OpenClaw's secret
   store and point the skill at it:

   ```bash
   openclaw secrets store set KNOWNAS_API_KEY --kind secret
   openclaw config set skills.entries.knownas.apiKey --ref-provider default --ref-source store --ref-id KNOWNAS_API_KEY
   openclaw secrets reload
   ```

   The first command asks for the key at a prompt that does not echo it.

4. **A public HTTPS origin** for the gateway: a tunnel (cloudflared, ngrok),
   Tailscale Funnel, or a reverse proxy. knownAs refuses loopback, private
   and IP-address origins.

## Install

```bash
openclaw plugins install clawhub:@authecity/openclaw-knownas
openclaw skills install @authecity/knownas
```

OpenClaw asks you to accept the plugin's capabilities on install: it adds
one unauthenticated HTTP route, `/.well-known/knownas-origin`, and nothing
else.

Then, in a chat with your agent: `/knownas setup myclaw`. It asks before it
creates anything, and before it changes anything public.

## How it works

1. The skill creates the identity (`api` and `webhooks`) and points each at
   your origin. knownAs answers each with a **proof token**.
2. The plugin serves those tokens at `https://<origin>/.well-known/knownas-origin`,
   one per line, unauthenticated, never cached. Tokens are not secrets: they
   only show that you control the server.
3. knownAs fetches that path. When it finds the token, the route is
   **verified**, and traffic to `<name>.api.knownas.dev` and
   `<name>.hooks.knownas.dev` is forwarded to your origin with the path
   unchanged. knownAs re-checks daily; three misses in a row pause the route,
   and the next pass resumes it.
4. On the first pass knownAs issues an **origin secret**. The skill stores it
   in OpenClaw's secret store as `KNOWNAS_ORIGIN_SECRET_API` (and `_WEBHOOKS`)
   and never prints it.

Forwarding is metered. Each agent has a traffic allowance, shown in the
console; above it, the agent is suspended until you resume it.

## Behind a tunnel: `proxy_attribution_required`

OpenClaw refuses forwarded traffic on its token-protected routes (its
OpenAI-compatible API, the Control UI) until it knows which proxy to trust.
Through a tunnel, with or without knownAs, those routes answer:

```json
{"error":{"message":"Proxy client attribution is required. ...","type":"proxy_attribution_required"}}
```

Channel webhooks and this plugin's route are plugin-authenticated and are
not affected. To use the gateway's own API through
`<name>.api.knownas.dev`, set `gateway.trustedProxies` to the address your
tunnel connects from (for a tunnel on the same machine, `127.0.0.1`), and
first read OpenClaw's "Reverse proxy configuration" guide: it requires the
proxy to overwrite `X-Forwarded-For`, not append to it, and whether yours
does decides whether trusting it is safe.

```bash
openclaw config set gateway.trustedProxies '["127.0.0.1"]' --strict-json
```

## The origin secret, and why the plugin does not check it

knownAs's edge sends the secret on every forwarded request as
`x-knownas-origin-secret`, so an origin can refuse traffic that did not come
through knownAs. **This plugin does not check it**, because inside OpenClaw it
cannot do so honestly:

- A plugin guards only its own routes. The gateway matches exact routes
  before prefix routes, refuses overlapping routes at different auth levels,
  and offers no HTTP middleware. A plugin cannot stand in front of the A2A
  endpoint or another channel's webhook.
- The only route this plugin owns is the proof route, and that one must stay
  open: knownAs fetches it before any secret exists.

A check on nothing would read as protection that is not there. Channels keep
their own verification (Telegram's secret token, LINE's signature, the A2A
peer token); knownAs adds a name, not a lock.

If you front the gateway with a reverse proxy, the proxy can enforce the
secret for everything. With Caddy, for example:

```caddyfile
myclaw.example.org {
	@viaKnownas header x-knownas-origin-secret {$KNOWNAS_ORIGIN_SECRET_API}
	handle /.well-known/knownas-origin {
		reverse_proxy 127.0.0.1:18789
	}
	handle @viaKnownas {
		reverse_proxy 127.0.0.1:18789
	}
	respond 403
}
```

Each route has its own secret; a proxy in front of both `api` and
`webhooks` accepts either.

## Develop

```bash
cd plugin
npm install
npm run build
npm test
```

The tests need `sh`, `curl` and `jq`; the helper's tests skip without `jq`.

## Status

Version 0.1, built against OpenClaw 2026.9.8 and tested end to end against
knownAs's development environment on 2026-10-07: identity created, both
routes verified through this plugin, secrets stored, webhook paths
forwarded unchanged, and a tunnel restart recovered with `/knownas repoint`
(the old name answered 530 until the repoint; the same name reached the new
tunnel about 35 seconds after it). The plugin SDK is marked experimental
upstream; each OpenClaw release this declares compatible is tested first.
