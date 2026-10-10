---
name: maglev-api-runtime
description: Start, inspect, or stop a local Maglev API service from a checkout or PR Bench using an isolated Docker Compose runtime.
---

# Maglev API runtime

Manage service lifecycle only. Do not infer or initiate testing, analysis, comparison, or any other activity from a request to start or stop the service.

1. Call `maglev_workspace_context` for checkout paths and PR Bench context.
2. Select the requested PR with `pr`, or an explicit checkout root with `workingDirectory`. Do not silently start a different checkout. No checkout is cloned or changed by this skill.
3. Use `maglev_api_runtime_start` with `implementation: "maglev"` and the selected target. Start is dry-run by default; set `apply: true` only when the user explicitly asks to start the API. Do not start services merely because another task might benefit from them.
4. Wait for successful completion. Report `sourcePath`, `version`, `baseUrl`, `apiKey`, and `ready`. Readiness requires non-empty agencies, not merely a responding HTTP server. A running container is not sufficient.
5. Use `maglev_api_runtime_status` with the same target to inspect containers/readiness. Missing runtimes are not started by status.
6. Use `maglev_api_runtime_stop` with the same target when explicitly asked to stop. Plan first if intent is unclear. By default it preserves database volumes and images. `removeVolumes: true` is destructive and requires explicit permission; `removeImages: true` removes project-local images only.

## Defaults and caveats

- Requires Docker Engine, Docker Compose v2, network access, and a checkout containing `Dockerfile` and `config.example.json`.
- Default URL is `http://127.0.0.1:4000`, API key `test`. `port` can select another loopback host port to avoid conflicts.
- Builds the selected checkout, including its local changes. Uses generated config outside the checkout; never rewrites checkout config or Compose files.
- Static GTFS defaults to Sound Transit's KCM feed. Override `gtfsUrl` on first start. Realtime feeds are disabled in this runtime.
- Per-checkout projects and persistent volumes are isolated. Ports must still be unique for simultaneously running Maglev checkouts.
- Saved feed/port settings are reused. To use different settings, use a separate configured maintainer root; cached bundles must not be mistaken for a new feed.
- `timeoutSeconds` defaults to 1800 for each build command and readiness wait. Initial builds can take many minutes.
- Failures leave containers available for inspection; show returned log path/Compose log command, then use status or explicitly stop. Do not claim readiness after an error.
- Services persist beyond the Pi session. Stop before closing/removing the PR Bench checkout; Bench close does not stop these runtimes.
