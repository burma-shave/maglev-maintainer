# Legacy OBA runtime assets

Adapted from burma-shave/maglev-workspace `.claude/skills/oba-api` at
commit `e3fcc1235e8d06c47240321ba7973780a529b5bb`:
https://github.com/burma-shave/maglev-workspace/tree/e3fcc1235e8d06c47240321ba7973780a529b5bb/.claude/skills/oba-api

`VERSION` pins the published OneBusAway Maven artifacts and matching reference
source tag. Docker build context `oba/` is carried over unchanged. The upstream
start/teardown shell scripts and Compose file are replaced by package-local tools:
`extensions/api-runtime.ts` generates isolated Compose projects with loopback API
ports, no fixed container names, no published MySQL port, and data-preserving stop.

The initial build downloads Maven artifacts, a GTFS tidy tool, and base images;
these transitive downloads are not fully pinned. Changing VERSION may require
updating the bundled Maven/templates/build assets and testing the full stack.
