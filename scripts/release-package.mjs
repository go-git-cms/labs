#!/usr/bin/env node
// Release one labs package to GitHub Packages. Called as:
//
//   node scripts/release-package.mjs <package-dir> <tag-prefix>
//
// Steps, in this order deliberately:
//   1. Gate: fingerprint the package's tracked contents (package.json version
//      excluded) and compare against the latest `<tag-prefix>-v*` tag. Equal →
//      nothing to release, exit 0. FORCE_RELEASE=true bypasses the gate.
//   2. `npm version minor` (no commit yet).
//   3. Resolve any `workspace:*` ranges, run the package's optional `build`
//      script, and `npm publish`.
//   4. ONLY after a successful publish: commit the bump with [skip ci], tag,
//      rebase-pull, and push.
//
// Publishing before tagging matters. Tagging first means a failed build or a
// registry hiccup leaves a `<tag>-v*` tag behind with nothing published, and
// the content gate then skips that package forever. In this order a failed run
// mutates nothing durable and the next push simply retries.
//
// Unlike the main monorepo's version of this script there is no publish-time
// identity rewriting: a labs package's workspace name IS its published name.
//
// Env:
//   FORCE_RELEASE=true   bypass the content gate
//   DRY_RUN=true         publish with --dry-run; skip the commit, tag and push
//   GITHUB_REF_NAME      branch to push to (default "main")

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [dir, tagPrefix] = process.argv.slice(2);
if (!dir || !tagPrefix) {
  console.error("usage: release-package.mjs <package-dir> <tag-prefix>");
  process.exit(2);
}

const root = path.resolve(import.meta.dirname, "..");
const branch = process.env.GITHUB_REF_NAME || "main";
const force = process.env.FORCE_RELEASE === "true";
const dryRun = process.env.DRY_RUN === "true";
const manifestPath = path.join(dir, "package.json");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });

// fingerprint hashes the package's tracked blobs at a ref, with package.json
// reduced to its version-less form — so the release bump itself (and nothing
// else) never counts as a content change.
//
// Returns null when the package does not exist at `dir` in `ref`, which is what
// a rename or a first release looks like from an older tag: `git show` fails
// outright there, and the gate must read that as "changed" rather than crash.
function fingerprint(ref) {
  const entries = git("ls-tree", "-r", ref, "--", dir)
    .split("\n")
    .filter((line) => line && !line.endsWith(`\t${dir}/package.json`));
  let raw;
  try {
    // stderr silenced: a missing path here is an expected answer, not an error
    // worth printing a `fatal:` line about.
    raw = execFileSync("git", ["show", `${ref}:${dir}/package.json`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  const manifest = JSON.parse(raw);
  delete manifest.version;
  return createHash("sha256")
    .update(entries.join("\n"))
    .update(JSON.stringify(manifest))
    .digest("hex");
}

// --- 1. gate ----------------------------------------------------------------
const tags = git("tag", "-l", `${tagPrefix}-v*`, "--sort=-v:refname");
const lastTag = tags.split("\n").filter(Boolean)[0];
const tagged = lastTag && !force ? fingerprint(lastTag) : null;
if (tagged !== null && tagged === fingerprint("HEAD")) {
  console.log(`${dir}: contents unchanged since ${lastTag} — nothing to release`);
  process.exit(0);
}

// A package without publishConfig.registry would publish to npmjs.com, where
// the @go-git-cms scope is not ours. Fail loudly rather than 403 halfway.
{
  const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const registry = m.publishConfig?.registry;
  if (!registry?.includes("npm.pkg.github.com")) {
    console.error(
      `${dir}: package.json needs "publishConfig": { "registry": "https://npm.pkg.github.com" } ` +
        `to publish to GitHub Packages (found: ${registry ?? "nothing"}). ` +
        `Set "private": true instead if this package is not meant to be released.`
    );
    process.exit(1);
  }
}

// resolveWorkspaceRanges turns `workspace:*` into a real semver range.
//
// pnpm understands `workspace:*` in this repository; npm does not, and a
// published package carrying one is broken on install with an error that names
// the protocol rather than the package. pnpm's own publish rewrites these, but
// this script publishes with `npm publish`, so the rewrite has to happen here.
//
// A dependency is pinned to `^<the sibling's current version>` — caret, because
// labs packages are released together and a consumer should pick up the newer
// sibling.
function resolveWorkspaceRanges(m) {
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = m[field];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range !== "string" || !range.startsWith("workspace:")) continue;
      const local = name.replace(/^@go-git-cms\//, "");
      const siblingManifest = path.join(root, "packages", local, "package.json");
      if (!fs.existsSync(siblingManifest)) {
        throw new Error(
          `${m.name} depends on ${name} with "${range}", but packages/${local}/package.json does not exist — ` +
            `a workspace range can only be resolved against a package in this repository`
        );
      }
      const sibling = JSON.parse(fs.readFileSync(siblingManifest, "utf8"));
      deps[name] = `^${sibling.version}`;
      console.log(`  ${field}: ${name}@${range} → ^${sibling.version}`);
    }
  }
}

// --- 2. bump (no commit) ----------------------------------------------------
run("npm", ["version", "minor", "--no-git-tag-version"], { cwd: dir });
const committable = fs.readFileSync(manifestPath, "utf8");
const version = JSON.parse(committable).version;
const tag = `${tagPrefix}-v${version}`;

// --- 3. build and publish ---------------------------------------------------
const manifest = JSON.parse(committable);
resolveWorkspaceRanges(manifest);
const rewritten = JSON.stringify(manifest, null, 2) + "\n";
if (rewritten !== committable) fs.writeFileSync(manifestPath, rewritten);

if (manifest.scripts?.build) {
  // verifyDepsBeforeRun must be off: the manifest written just above may have
  // replaced `workspace:*` with a semver range, so pnpm's pre-run check sees
  // specifiers that no longer match pnpm-lock.yaml and re-runs install — which
  // under CI is frozen-lockfile and fails before the build ever runs. Nothing
  // needs installing here; the workspace was installed before this script ran.
  run("pnpm", ["--config.verifyDepsBeforeRun=false", "run", "build"], { cwd: dir });
}

run("npm", ["publish", ...(dryRun ? ["--dry-run"] : [])], { cwd: dir });
console.log(`${dryRun ? "[dry run] would publish" : "published"} ${manifest.name}@${version}`);

// --- 4. record the release (only now that publish succeeded) ----------------
fs.writeFileSync(manifestPath, committable); // drop any resolved workspace ranges
if (dryRun) {
  git("checkout", "--", manifestPath);
  console.log(`[dry run] would tag ${tag}`);
  process.exit(0);
}
git("config", "user.name", "github-actions[bot]");
git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
git("add", manifestPath);
git("commit", "-m", `chore: release ${tagPrefix} v${version} [skip ci]`);
// Land on top of anything that arrived while this run was queued.
run("git", ["pull", "--rebase", "origin", branch]);
git("tag", tag);
run("git", ["push", "origin", `HEAD:${branch}`, tag]);
console.log(`tagged ${tag}`);
