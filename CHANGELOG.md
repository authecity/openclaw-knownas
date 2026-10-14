# Changelog

## 0.2.0 (2026-10-14), skill only

- The second-agent moment: after `/knownas setup`, the skill says once,
  "Your first name is free. A second agent can have one too", the wording
  the knownAs console uses under an account's list (approved 2026-10-14).
  A new `/knownas second` explains how: install the skill on the other
  agent's gateway with a key for the same account and run setup there with
  a different name. The rule stays: one gateway, one name; the skill never
  creates a second identity for the gateway it runs on, and never quotes a
  price (the console and the FAQ do).
- `references/faq.md` re-rendered from knownAs.dev's FAQ, which gains "Can
  a second agent have a name too?" under OpenClaw.
- The plugin is unchanged and stays at 0.1.0.

## 0.1.0 (2026-10-07)

- The `knownas` skill: `/knownas setup`, `repoint`, `channels`, `status`,
  `remove`, all through one helper script (`curl` and `jq`) that keeps the
  API key off every command line and stores the origin secret without
  printing it.
- The `knownas` plugin: `GET /.well-known/knownas-origin` serves the
  configured proof tokens, one per line, `text/plain`, `no-store`; 404 when
  none is configured. No outbound calls.
- No origin-secret check in the plugin: OpenClaw's plugin SDK cannot guard
  another plugin's routes (see the README).
- Tested end to end on knownAs dev with OpenClaw 2026.9.8 (2026-10-07).
  Token changes hot-reload; the API key comes from OpenClaw's secret store
  through a `store` SecretRef; gateway-authenticated routes behind a tunnel
  need `gateway.trustedProxies` (README).
- `references/faq.md`: the knownAs.dev FAQ's forwarding, OpenClaw, traffic
  and API-key answers, which the skill reads first when something fails.
- The README's account step points at https://knownas.dev/openclaw, where an
  eligible person gets an invitation by email within a minute (ADR 0045).
