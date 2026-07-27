# components/

Everything the MDX editor loads from the project lives here: one file per
component it should render live, plus any CSS or JS those components need.

## Components

One file, re-exporting the real thing:

```tsx
// Canvas.tsx
export { default } from "../../../src/lib/@ui/Canvas";
```

Then name it in `cms.config.mjs`:

```js
components: { Canvas: "Canvas" }
```

It is also the place to adapt a component that can't run in the CMS as-is —
stub out an `astro:content` query, supply a default prop, wrap a provider.

## Styles and scripts

```js
styles: ["site.css", "https://fonts.googleapis.com/css2?family=Inter"],
scripts: ["register-elements.ts", "https://cdn.example.com/prism.js"],
```

An absolute URL is injected as a `<link>` or `<script>` tag. Anything else is a
file in this directory and is imported, so the bundler processes it.

`site.css` here is Tailwind's utilities and components, generated from the
project's own `tailwind.config.cjs`:

```bash
npm run cms:styles
```

Re-run that after using a utility class the editor hasn't seen before —
Tailwind only emits the classes it finds in your source. `@tailwind base` is
deliberately excluded: preflight is a global reset and would restyle the CMS's
own chrome, not just your components.

## Why the indirection

Vite needs a literal `import.meta.glob` pattern, and it resolves **every file
the pattern matches** — in dev as well as in a build. An earlier version
globbed the project's `src/` directly, which quietly made every `.tsx` in the
project a dependency of the editor: one file importing `astro:content`, or a
package that isn't installed, broke the dev server on its own.

A directory the plugin owns bounds that to files someone deliberately put here.
