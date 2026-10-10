import { join } from "node:path";
import { resolveMaintainerRoot } from "./identity.ts";

export const MAINTAINER_ROOT = resolveMaintainerRoot();

export const STATE_DIR = join(MAINTAINER_ROOT, "state");
export const SNAPSHOT_FILE = join(STATE_DIR, "github-snapshot.json");
export const DECISIONS_FILE = join(STATE_DIR, "decisions.json");
export const BENCH_STATE_DIR = join(MAINTAINER_ROOT, "benches");
export const BENCH_CHECKOUTS_DIR = join(MAINTAINER_ROOT, "checkouts");
export const REVIEW_JSON_DIR = join(MAINTAINER_ROOT, "review-json");
export const COMPANION_REPOS_DIR = join(MAINTAINER_ROOT, "companion-repos");
