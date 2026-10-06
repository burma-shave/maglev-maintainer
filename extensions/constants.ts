export const REPO = "OneBusAway/maglev";
export const SNAPSHOT_SCHEMA_VERSION = 1;
export const DECISIONS_SCHEMA_VERSION = 1;
export const SNAPSHOT_STALE_AFTER_HOURS = 4;

export const VALID_BUCKETS = ["review", "chase", "pinned", "watch"] as const;
export const VALID_BUCKET_SET = new Set<string>(VALID_BUCKETS);
export const BOT_LOGINS = new Set(["coderabbitai", "sonarqubecloud", "github-actions", "CLAassistant"]);
export const MAINTAINER_LOGINS = new Set(["burma-shave", "aaronbrethorst", "Ahmedhossamdev"]);
