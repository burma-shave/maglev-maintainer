import { join, resolve } from "node:path";

export const MAGLEV_PR_MAINTAINER_ROOT = process.env.MAGLEV_PR_MAINTAINER_ROOT
	? resolve(process.env.MAGLEV_PR_MAINTAINER_ROOT)
	: "/var/lib/maglev-pr-maintainer";

export const STATE_DIR = join(MAGLEV_PR_MAINTAINER_ROOT, "state");
export const SNAPSHOT_FILE = join(STATE_DIR, "github-snapshot.json");
export const DECISIONS_FILE = join(STATE_DIR, "decisions.json");
export const BENCH_STATE_DIR = join(MAGLEV_PR_MAINTAINER_ROOT, "benches");
export const BENCH_CHECKOUTS_DIR = join(MAGLEV_PR_MAINTAINER_ROOT, "checkouts");
export const REVIEW_JSON_DIR = join(MAGLEV_PR_MAINTAINER_ROOT, "review-json");
export const COMPANION_REPOS_DIR = join(MAGLEV_PR_MAINTAINER_ROOT, "companion-repos");
