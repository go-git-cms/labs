#!/usr/bin/env node
// Emit the publishable workspace packages as a JSON array, for the publish
// workflow's matrix. Called with no arguments; prints one line of JSON.
//
// The main monorepo hardcodes its release matrix, which is right there — the
// package list is stable and the release order is load-bearing. Labs is an
// incubator: packages appear and get deleted, and adding one should not mean
// editing CI. So the matrix is discovered from packages/* instead, and the
// contract for being released is just "not private, and says where to publish".

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packagesDir = path.join(root, "packages");

const found = [];
for (const name of fs.readdirSync(packagesDir).sort()) {
  const manifestPath = path.join(packagesDir, name, "package.json");
  if (!fs.existsSync(manifestPath)) continue;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.private) continue;

  found.push({
    entry: {
      dir: `packages/${name}`,
      name: manifest.name,
      // The tag prefix is the directory name, not the package name: a scoped
      // name contains a `/`, which git tags cannot carry.
      tag: name,
      // Only a package that builds needs the workspace installed — everything
      // else publishes its source as-is and the install is dead time.
      needsInstall: Boolean(manifest.scripts?.build),
    },
    // Siblings this package depends on, by package name.
    deps: ["dependencies", "peerDependencies", "optionalDependencies"]
      .flatMap((field) => Object.entries(manifest[field] ?? {}))
      .filter(([, range]) => typeof range === "string" && range.startsWith("workspace:"))
      .map(([dep]) => dep),
  });
}

// Dependency order, not alphabetical order. The matrix runs serially, and
// release-package.mjs pins a `workspace:*` dependency to the sibling's
// *current* version — so a package published before its sibling's bump lands
// pins a version that does not exist in the registry, and installs break. The
// main monorepo solves this by hand-ordering its matrix; here the order has to
// come out of the manifests, since the matrix is discovered.
//
// A cycle can't be ordered. pnpm permits one, so emit the remainder in
// alphabetical order rather than dropping packages from the release.
const byName = new Map(found.map((p) => [p.entry.name, p]));
const out = [];
const state = new Map(); // name → "visiting" | "done"
function visit(pkg) {
  if (state.get(pkg.entry.name)) return; // done, or a cycle we already entered
  state.set(pkg.entry.name, "visiting");
  for (const dep of pkg.deps) {
    const sibling = byName.get(dep);
    if (sibling && state.get(sibling.entry.name) !== "visiting") visit(sibling);
  }
  state.set(pkg.entry.name, "done");
  out.push(pkg.entry);
}
for (const pkg of found) visit(pkg);

console.log(JSON.stringify(out));
