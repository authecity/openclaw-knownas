# Changelog

## 0.1.0 (unreleased)

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
