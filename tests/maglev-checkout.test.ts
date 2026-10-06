import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatMaglevCheckout, maglevCheckoutPath, resolveMaglevCheckout } from "../extensions/maglev-checkout.ts";

const origin = "https://github.com/OneBusAway/maglev.git";
function git(...args: string[]) { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
	const root = await mkdtemp(join(tmpdir(), "maglev-checkout-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const source = join(root, "source");
	git("init", "-b", "main", source);
	git("-C", source, "config", "user.name", "Test");
	git("-C", source, "config", "user.email", "test@example.com");
	await writeFile(join(source, "README"), "main\n");
	git("-C", source, "add", "."); git("-C", source, "commit", "-m", "initial");
	git("-C", source, "tag", "v1");
	git("-C", source, "checkout", "-b", "topic");
	await writeFile(join(source, "README"), "topic\n");
	git("-C", source, "commit", "-am", "topic");
	const topic = git("-C", source, "rev-parse", "HEAD");
	git("-C", source, "checkout", "main");
	const calls: string[][] = [];
	const options = {
		checkoutDir: join(root, "checkouts"),
		runGit: async (args: string[]) => {
			calls.push(args);
			try {
				if (args[0] === "clone") {
					const localArgs = args.map((arg) => arg === origin ? source : arg);
					const stdout = git(...localArgs);
					git("-C", args.at(-1)!, "config", "remote.origin.url", origin);
					return { ok: true, stdout, stderr: "" };
				}
				if (args[2] === "fetch") {
					return { ok: true, stdout: git(...args.map((arg, i) => i === 4 ? source : arg)), stderr: "" };
				}
				return { ok: true, stdout: git(...args), stderr: "" };
			} catch (err) { return { ok: false, stdout: "", stderr: String(err) }; }
		},
	};
	return { root, source, calls, options, topic, path: maglevCheckoutPath(options) };
}

test("default paths honor maintainer root and OBA_WORKSPACE", () => {
	assert.equal(maglevCheckoutPath({ checkoutDir: "/root/checkouts" }), "/root/checkouts/maglev");
	assert.equal(maglevCheckoutPath({ checkoutDir: "/root/checkouts", obaWorkspace: "/oba" }), "/oba/maglev");
});

test("missing checkout is a dry-run with no filesystem or Git mutations", async (t) => {
	const f = await fixture(t);
	const result = await resolveMaglevCheckout({}, f.options);
	assert.equal(result.ok, true); assert.equal(result.ready, false); assert.equal(result.cloned, false);
	assert.deepEqual(f.calls, []);
	assert.deepEqual((await readdir(f.root)).sort(), ["source"]);
	assert.match(formatMaglevCheckout(result), /planned \(not applied\)/);
});

test("apply clones the remote default branch and reports revision", async (t) => {
	const f = await fixture(t);
	const result = await resolveMaglevCheckout({ apply: true }, f.options);
	assert.equal(result.ok, true); assert.equal(result.ready, true); assert.equal(result.cloned, true);
	assert.equal(result.branch, "main"); assert.equal(result.dirty, false);
	assert.equal(result.head, git("-C", f.source, "rev-parse", "HEAD"));
	assert.deepEqual(await readdir(f.options.checkoutDir), ["maglev"]);
});

for (const ref of ["topic", "v1", "refs/heads/topic", "sha"]) {
	test(`explicit ${ref} clones to detached HEAD`, async (t) => {
		const f = await fixture(t);
		const requested = ref === "sha" ? f.topic : ref;
		const result = await resolveMaglevCheckout({ apply: true, ref: requested }, f.options);
		assert.equal(result.ok, true, result.errors.join("\n")); assert.equal(result.branch, undefined);
		assert.equal(result.head, git("-C", f.source, "rev-parse", `${requested}^{commit}`));
	});
}

test("existing dirty checkout is preserved without fetching, even with apply", async (t) => {
	const f = await fixture(t);
	await resolveMaglevCheckout({ apply: true }, f.options);
	await writeFile(join(f.path, "README"), "local edits\n");
	await writeFile(join(f.path, "untracked"), "keep me\n");
	f.calls.length = 0;
	const result = await resolveMaglevCheckout({ apply: true }, f.options);
	assert.equal(result.ok, true); assert.equal(result.dirty, true); assert.equal(result.cloned, false);
	assert.equal(await readFile(join(f.path, "README"), "utf8"), "local edits\n");
	assert.equal(await readFile(join(f.path, "untracked"), "utf8"), "keep me\n");
	assert.ok(f.calls.every((args) => !args.some((arg) => ["fetch", "pull", "checkout", "reset", "clone"].includes(arg))));
});

test("existing requested ref must already match HEAD", async (t) => {
	const f = await fixture(t);
	await resolveMaglevCheckout({ apply: true }, f.options);
	assert.equal((await resolveMaglevCheckout({ ref: "main" }, f.options)).ok, true);
	const result = await resolveMaglevCheckout({ ref: "topic", apply: true }, f.options);
	assert.equal(result.ok, false); assert.match(result.errors.join(" "), /does not match/);
	assert.equal(git("-C", f.path, "branch", "--show-current"), "main");
});

test("wrong origins, non-repositories, and nested directories are refused", async (t) => {
	const f = await fixture(t);
	await resolveMaglevCheckout({ apply: true }, f.options);
	const nested = join(f.path, "nested"); await mkdir(nested);
	assert.equal((await resolveMaglevCheckout({ path: nested }, f.options)).ok, false);
	git("-C", f.path, "config", "remote.origin.url", "https://github.com/other/maglev.git");
	assert.equal((await resolveMaglevCheckout({}, f.options)).ok, false);
	const empty = join(f.root, "empty"); await mkdir(empty);
	assert.equal((await resolveMaglevCheckout({ path: empty, apply: true }, f.options)).ok, false);
});

test("failed clone/ref fetch leaves no target or staging directory", async (t) => {
	const f = await fixture(t);
	const result = await resolveMaglevCheckout({ apply: true, ref: "nonexistent" }, f.options);
	assert.equal(result.ok, false); assert.equal(result.cloned, false);
	assert.deepEqual(await readdir(f.options.checkoutDir), []);
	const failed = await resolveMaglevCheckout({ apply: true }, { ...f.options, runGit: async () => ({ ok: false, stdout: "", stderr: "offline" }) });
	assert.equal(failed.ok, false); assert.match(failed.errors.join(" "), /offline/);
	assert.deepEqual(await readdir(f.options.checkoutDir), []);
});

test("option and revision-expression refs are rejected", async (t) => {
	const f = await fixture(t);
	for (const ref of ["--upload-pack=evil", "HEAD~1", "a:b", "", "branch name"]) {
		assert.equal((await resolveMaglevCheckout({ apply: true, ref }, f.options)).ok, false);
	}
	assert.equal(f.calls.some((args) => args[0] === "clone"), false);
});

test("a target created while cloning is never replaced, even if empty", async (t) => {
	const f = await fixture(t);
	const result = await resolveMaglevCheckout({ apply: true }, { ...f.options, runGit: async (args) => {
		const response = await f.options.runGit(args);
		if (args[0] === "clone") await mkdir(f.path);
		return response;
	} });
	assert.equal(result.ok, false);
	assert.match(result.errors.join(" "), /not replaced/);
	assert.deepEqual(await readdir(f.path), []);
	assert.deepEqual(await readdir(f.options.checkoutDir), ["maglev"]);
});

test("status failure fails closed instead of treating local work as clean", async (t) => {
	const f = await fixture(t);
	await resolveMaglevCheckout({ apply: true }, f.options);
	const result = await resolveMaglevCheckout({}, { ...f.options, runGit: async (args) => args[2] === "status" ? { ok: false, stdout: "", stderr: "failed" } : f.options.runGit(args) });
	assert.equal(result.ok, false); assert.equal(result.dirty, undefined);
});
