// Separate-process decision regression fixture. Every path is supplied by the test.
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

const [file, operation, prText, mode] = process.argv.slice(2);
if (!file || !file.startsWith(process.env.FIXTURE_ROOT + "/")) throw new Error("Decision fixture requires an isolated root");
const mkdir = fs.mkdir;
fs.mkdir = (async (...args: Parameters<typeof fs.mkdir>) => {
	try {
		return await mkdir(...args);
	} catch (error) {
		if (args[0] === `${file}.lock` && (error as NodeJS.ErrnoException).code === "EEXIST") process.send?.({ event: "contended" });
		throw error;
	}
}) as typeof fs.mkdir;
syncBuiltinESMExports();

const { deleteDecision, saveDecision } = await import("../extensions/decisions.ts");
const { loadDecisionsFromFile, writeDecisionsToFile } = await import("../extensions/state-core.ts");
const release = new Promise<void>((resolve) => process.on("message", (message) => { if (message === "release") resolve(); }));
const deps = {
	decisionsFile: file,
	loadDecisions: async () => {
		const loaded = await loadDecisionsFromFile(file);
		process.send?.({ event: "loaded" });
		if (mode === "pause") await release;
		return loaded;
	},
	writeDecisions: (next: Parameters<typeof writeDecisionsToFile>[1]) => writeDecisionsToFile(file, next),
};
try {
	if (operation === "delete") await deleteDecision(Number(prText), deps);
	else await saveDecision(Number(prText), { bucket: "review", reason: "ready for review" }, deps);
	process.send?.({ event: "done" });
	process.disconnect?.();
} catch (error) {
	process.send?.({ event: "error", message: String(error) });
	process.exitCode = 1;
	process.disconnect?.();
}
