# Go·Git CMS Labs

Experimental packages that extend [Go·Git CMS](https://github.com/go-git-cms/gogitcms)
— editor plugins, field components, preview adapters, and anything else that
plugs into a CMS host without forking it.

Labs is where an extension lives before it is a product. A package here is
built against the real plugin API and is meant to be installed and used, but it
carries none of the CMS's stability promises:

- **APIs break.** A labs package tracks the plugin SDK's current shape, not a
  released one. A minor bump can change its options or its rendering.
- **Coverage is uneven.** Some packages have tests; some have a README and a
  hunch.
- **Graduation is the goal.** A package that earns its keep moves into the main
  monorepo (`packages/`) and joins the release train. One that doesn't gets
  deleted, and that is a fine outcome — it is what "labs" buys you.

If you need something you can depend on in production, take it from the CMS
release, not from here.

## Packages

| Package | |
| --- | --- |
| [`@go-git-cms/plugin-mdx`](packages/plugin-mdx) | An MDX body editor: ProseMirror prose, an imports/exports footer, and live rendering of the project's own React components with inline prop editing |

## Layout

```
packages/<name>/       one npm package, published as @go-git-cms/<name>
pnpm-workspace.yaml    workspace members + the react/react-dom pin
.npmrc                 points the @go-git-cms scope at GitHub Packages
```

Every package is a workspace member (`packages/*`), so a package may depend on
another with `"workspace:*"` and pnpm links it rather than fetching it.

## Requirements

- Node ≥ 20
- pnpm 11.15.0 — `corepack enable` picks it up from `packageManager`
- A `read:packages` GitHub token in `~/.npmrc`, **if** a package you install
  actually resolves `@go-git-cms/plugin-sdk` or `@go-git-cms/design-system`.
  GitHub Packages authenticates downloads even for public repos:

  ```
  //npm.pkg.github.com/:_authToken=<token>
  ```

  Those two are *optional* peers everywhere, so a plain `pnpm install` at the
  root does not need the token.

## Commands

```bash
pnpm install                              # install every package
pnpm build                                # build all (skips packages with no build script)
pnpm test                                 # test all
pnpm typecheck                            # typecheck all
```

Everything at the root is `pnpm -r --if-present <script>`: a package without
that script is skipped rather than failing the run.

Scoping to one package:

```bash
pnpm --filter @go-git-cms/plugin-mdx test
pnpm --filter @go-git-cms/plugin-mdx add -D typescript
pnpm --filter @go-git-cms/plugin-mdx exec tsc --noEmit
```

`--filter ...@go-git-cms/plugin-mdx` (with the leading `...`) includes that
package's workspace dependencies too.

## Using a labs package in a real project

A plugin is only meaningfully testable inside a CMS host, so point a project's
`cms.config.mjs` at your working copy. A relative path is resolved from the
project directory and needs no install at all:

```js
// cms.config.mjs
export default {
  plugins: [
    ["../labs/packages/plugin-mdx", { /* options */ }],
  ],
};
```

For a package that must resolve as a real dependency (it has its own
`node_modules`, or the host resolves it by name), link it instead:

```bash
pnpm --filter @go-git-cms/plugin-mdx exec pnpm link --global
cd ../my-site && pnpm link --global @go-git-cms/plugin-mdx
```

Then run the host as usual (`cms-frontend dev`, `gitcms-ide dev`). Both bundling
hosts read `plugins` from the project's `cms.config.mjs` and provide it as the
`virtual:cms-plugins` module; the desktop app loads installed plugins at
runtime instead and cannot see a local path.

## Contributing

### Adding a package

1. Create `packages/<name>/` with a `package.json` named
   `@go-git-cms/<name>`. Start at `0.1.0`.
2. Write the entrypoint. A plugin's `main` must default-export the setup
   function that receives `CmsPluginApi`:

   ```js
   export default function setup(cms, options) {
     cms.addRoute({ path: "thing", title: "Thing", component: () => import("./Screen.js") });
     cms.addSidebarLink({ label: "Thing", icon: "braces", to: "thing" });
     cms.registerFieldComponent({
       name: "thing",              // a schema addresses it as "plugin:thing"
       types: ["string"],
       component: () => import("./ThingField.js"),
     });
   }
   ```

3. Add a row to the [Packages](#packages) table above and a `README.md` in the
   package (see [Documenting](#documenting)).
4. `pnpm install` to link it into the workspace.

`examples/plugin-hello` in the main monorepo is the reference plugin, and
`docs/plugin-system.md` there is the full API contract. Read both before
inventing something.

### Packaging rules

These are not style preferences — breaking one of them breaks the host at
runtime, usually in a way that looks like a React bug.

| Rule | Why |
| --- | --- |
| `"type": "module"`, and `main` points at ESM | The desktop host imports the entrypoint natively; the SPA build assumes ESM |
| `react`, `react-dom`, `react-native`, `@go-git-cms/design-system`, `@go-git-cms/plugin-sdk` are **optional peers**, never dependencies | The host provides them. A second React means broken hooks; a second design system means a lost theme context. Optional so a plain install of the package doesn't try to fetch them |
| Contributions are **loaders** — `() => import("./X")` | A plain function component is indistinguishable from a loader at runtime, so a direct value is not supported. The loader also gets its own lazy chunk |
| No install-time scripts | Neither host runs them; the desktop installer only extracts the tarball |
| Everything else is bundled into the package | Only the peers above are external |

A manifest that follows all of it:

```json
{
  "name": "@go-git-cms/plugin-thing",
  "version": "0.1.0",
  "description": "One sentence on what it does, in the present tense.",
  "type": "module",
  "main": "src/index.js",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/go-git-cms/gogitcms-labs.git",
    "directory": "packages/plugin-thing"
  },
  "publishConfig": { "registry": "https://npm.pkg.github.com" },
  "peerDependencies": {
    "@go-git-cms/design-system": "*",
    "@go-git-cms/plugin-sdk": "*",
    "react": "*"
  },
  "peerDependenciesMeta": {
    "@go-git-cms/design-system": { "optional": true },
    "@go-git-cms/plugin-sdk": { "optional": true }
  }
}
```

A package with no build step ships its source as `main`, as `plugin-hello` does
— it is the least that can go wrong. Add a build only when the source can't be
imported as-is (TypeScript, JSX in a runtime-loaded file), and then set
`"build"` in `scripts` so the root `pnpm build` picks it up.

### Documenting

Each package needs a `README.md` that answers, in this order: what it does,
how a schema or config addresses it, what options it takes, and what it
deliberately doesn't handle. [`plugin-mdx`](packages/plugin-mdx/README.md) is
the model — note that it spends as much space on *why* a decision was made as
on what the decision was. That is the part that stays useful when someone picks
the package up six months later, or has to change it.

Two things worth writing down every time:

- **The known-broken.** A labs package is allowed rough edges; an undocumented
  rough edge is a bug report waiting to happen.
- **The constraint behind an awkward API.** If an option looks redundant, say
  what would break without it.

### Conventions

- Commits: present-tense subject, scoped when it helps —
  `plugin-mdx: lift imports into the footer`.
- One package per PR where you can. A labs package is a unit of experiment.
- Bump the package's own `version` when its behaviour changes. Versions here
  are minor-bumped freely; nothing downstream is promising otherwise.
- Run `pnpm test` and `pnpm typecheck` before opening a PR. Both skip packages
  that don't define the script, so a green run is not a coverage claim — say in
  the PR what you actually exercised, and in which host.

### Publishing

Nothing here publishes automatically. When a package is ready to be installed
by name, publish it to GitHub Packages under the `@go-git-cms` scope (the
`publishConfig` above already points there) with a `write:packages` token:

```bash
pnpm --filter @go-git-cms/plugin-thing publish --access restricted
```

Graduating a package into the main monorepo is the other path, and the better
one for anything that has stopped being an experiment: move it to `packages/`
there, add it to `pnpm-workspace.yaml`, and wire it into
`.github/workflows/publish-packages.yml` so releases are content-gated like
every other package.
