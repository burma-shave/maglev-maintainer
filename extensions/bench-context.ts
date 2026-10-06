import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Unique files prevent later starts from changing a live session's context.
// Kept outside the checkout, and read by Pi via --append-system-prompt.
export async function writeBenchContext(stateDir: string, context: string): Promise<string> {
	await mkdir(stateDir, { recursive: true });
	const path = resolve(join(stateDir, `context-${randomUUID()}.md`));
	await writeFile(path, context, { encoding: "utf8", flag: "wx", mode: 0o600 });
	return path;
}
