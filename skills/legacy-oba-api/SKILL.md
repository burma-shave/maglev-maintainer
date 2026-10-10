---
name: legacy-oba-api
description: Start, inspect, or stop the pinned legacy Java OneBusAway API service using an isolated Docker Compose runtime.
---

# Legacy OBA API runtime

Manage service lifecycle only. Do not infer or initiate testing, analysis, comparison, or any other activity from a request to start or stop the service.

1. Call `maglev_workspace_context` before resolving runtime paths.
2. Use `maglev_api_runtime_start` with `implementation: "legacy"`. Do not supply `pr` or `workingDirectory`; this runtime uses the version pinned in the package's `assets/legacy-oba/VERSION`.
3. Dry-run is the default. Set `apply: true` only when the user explicitly requests starting the legacy API. Do not start services merely because another task might benefit from them.
4. Wait for successful completion and capture `version`, `sourcePath`, `baseUrl`, `apiKey`, and `ready`. Report these service details to the user. The tool caches matching Java source under the maintainer root and builds Maven artifacts for the pinned version.
5. Use `maglev_api_runtime_status` with `implementation: "legacy"` to inspect readiness and container state. Even already-running services must pass the non-empty agencies readiness check.
6. On an explicit stop request, use `maglev_api_runtime_stop` with `implementation: "legacy", apply: true`. GTFS bundle and MySQL volumes are preserved by default. Only use `removeVolumes: true` after explicit permission to destroy those data; use `removeImages: true` only when image removal is requested.

## Defaults and caveats

- Requires Docker Engine, Docker Compose v2, Git, network access, and enough disk/memory for Tomcat, MySQL, and the GTFS bundle build.
- Default base URL: `http://127.0.0.1:8080`; API key: `test`. Host MySQL is not exposed. Containers have no global fixed names.
- Default static feed is Sound Transit's KCM feed. Override `gtfsUrl` or `port` on first start. Realtime is not configured.
- The cached Java source matches the pinned release. This Docker image retrieves published Maven artifacts rather than compiling local Java edits.
- The first start can take many minutes. Default `timeoutSeconds` is 1800 for each build command and readiness wait.
- Readiness means a successful OBA envelope and non-empty agencies. Do not substitute `current-time` or assume a running Tomcat has loaded transit data.
- Saved feed/port settings are reused. For different settings use a separate configured maintainer root so the persisted GTFS bundle cannot silently mismatch the feed.
- Failures leave containers for inspection; report the build log and returned Compose log command. Do not automatically destroy volumes as recovery.
- Services persist after Pi exits; stop them only when requested.
