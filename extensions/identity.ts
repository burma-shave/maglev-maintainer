import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The manifest is the source of package identity; tool names and durable Bench
// identities are deliberately independent of branding.
export const PACKAGE_NAME: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).name;
export const DISPLAY_NAME = PACKAGE_NAME.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
export const ROOT_ENV_VAR = `${PACKAGE_NAME.toUpperCase().replaceAll("-", "_")}_ROOT`;
export const DEFAULT_MAINTAINER_ROOT = `/var/lib/${PACKAGE_NAME}`;
export const INFO_COMMAND = `${PACKAGE_NAME}-info`;
export const STATUS_COMMAND = `${PACKAGE_NAME}-status`;
export const TRIAGE_AGENT = `${PACKAGE_NAME}.pr-triage-analyst`;

export function resolveMaintainerRoot(env: Record<string, string | undefined> = process.env): string {
	// Explicit legacy configuration remains supported, but no old directories
	// are discovered, moved, or read implicitly.
	const configured = env[ROOT_ENV_VAR] || env.MAGLEV_PR_MAINTAINER_ROOT;
	return configured ? resolve(configured) : DEFAULT_MAINTAINER_ROOT;
}
