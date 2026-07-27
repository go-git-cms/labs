# @go-git-cms/plugin-mdx

An MDX body editor for Go·Git CMS, built on ProseMirror via
[`@handlewithcare/react-prosemirror`](https://github.com/handlewithcarecollective/react-prosemirror).
It registers one field component, addressed from a schema as `plugin:mdx`:

```yaml
- name: body
  type: string
  display:
    component: "plugin:mdx"
    source: body
```

## What it does with a document

MDX is markdown plus two things markdown has no idea about — an import/export
header and JSX elements. The editor treats each on its own terms rather than
dumping both into the prose:

| MDX construct | In the editor |
| --- | --- |
| `import` / `export` | Lifted out of the document entirely; owned by the **footer** |
| `<Callout>…</Callout>` with a configured component | The component itself, rendered with its props; children still editable |
| `<Callout>…</Callout>` with no configured component | A **card** showing the tag and its props |
| `<>…</>` and `<Fragment slot="x">` | Passed straight through — a fragment renders nothing of its own |
| `<Badge>x</Badge>` mid-sentence | An inline chip; click the tag to edit its props |
| `{expr}` in a block position | An opaque source chip |
| everything else | Ordinary rich text |

A configured component renders as *itself* — no card, no header, nothing of the
editor's between it and the page. The only addition is a control that floats
over its top-right corner on hover, replacing the element with a props form in
place. Committing the form writes the attributes back to the node, and the
document re-serializes to MDX.

A component that throws is caught and falls back to the card with the error
message; changing any prop gives it another go.

## Options

Live rendering takes two steps. First, a file in `components/` re-exporting the
component you want:

```tsx
// plugins/plugin-mdx/components/Canvas.tsx
export { default } from "../../../src/lib/@ui/Canvas";
```

Then the plugin entry in `cms.config.mjs` maps a JSX tag name onto it:

```js
plugins: [
  ["./plugins/plugin-mdx", {
    components: {
      // shorthand: the module's name in components/
      Canvas: "Canvas",

      // long form: a named export, plus declared props for the edit form
      Code: {
        path: "Code",
        export: "default",
        props: [
          { name: "lang", type: "string", options: ["ts", "js", "go"] },
          { name: "title", type: "string" },
          { name: "wrap", type: "boolean" },
          { name: "lines", type: "expression", required: true },
        ],
      },
    },
  }],
]
```

`props` is optional. When present, the edit form offers those props as
one-click chips, renders a `<select>` for `options`, and picks the right input
for the `type`. Undeclared props are still editable — the form never limits you
to the declared set.

### Global CSS and JS

A component rendered without its stylesheet is not really rendered, so the
assets go in the config too:

```js
styles: ["site.css", "https://fonts.googleapis.com/css2?family=Inter"],
scripts: ["register-elements.ts", "https://cdn.example.com/prism.js"],
```

An absolute URL is injected as a `<link>`/`<script>` tag, exactly as a page
would load it. Anything else is a file in `components/` and is imported, so the
bundler processes and fingerprints it. Styles load in parallel; scripts run in
config order, since a script list is usually a dependency order.

For a Tailwind project, `npm run cms:styles` generates `components/site.css`
from the project's own `tailwind.config.cjs` — utilities and components only,
never `@tailwind base`, because preflight is a global reset that would restyle
the CMS's own chrome. Re-run it after using a class the editor hasn't seen.

### Why the two steps

Both CMS hosts serialize plugin options to JSON when they generate the
`virtual:cms-plugins` module, so a component **cannot** be passed by reference.
The plugin has to import it by name, and Vite only understands a *literal*
`import.meta.glob` pattern.

The catch is that Vite resolves **every file the pattern matches**, in dev as
well as in a build. An earlier version of this plugin globbed the project's
`src/` directly, which quietly made every `.tsx` in the project a dependency of
the editor: `src/components/CardArticle.tsx` (imports `astro:content`) and
`src/lib/@ui/Dialog/DialogProvider.tsx` (imports `@react-aria/overlays`, which
react-aria 3.50 no longer exposes) each broke the dev server on their own,
without any document using them.

Globbing a directory the plugin owns bounds that to files someone deliberately
put there. It is also where you adapt a component that can't run in the CMS
as-is — stub an `astro:content` query, supply a default prop, wrap a provider.

A component that still can't load is not fatal: it logs a warning and falls
back to the card. Only an unresolvable *import* inside `components/` breaks the
build, which is why `ToggleFAB` is not wired up here — it reaches `Search` →
`Dialog` → `DialogProvider` and that `@react-aria/overlays` import.

### Which props reach the component

`{['npm', 'yarn']}` is a real prop and the component gets it, so expressions
are evaluated — in strict mode, with the browser's ambient objects (`window`,
`document`, `fetch`, `localStorage`, `process`, `require`, …) shadowed to
`undefined`. What that leaves is arithmetic over literals.

`{generateUrl({ title: frontmatter.title })}` is a different thing: it reads
the document's own imports and frontmatter, neither of which exists in the
editor. Those identifiers are simply not bound, so evaluation throws a
ReferenceError and the prop is reported unresolved on the hover control rather
than guessed at.

Either way the source text is never modified — it round-trips to MDX exactly as
written. Astro template directives (`client:idle`, `set:html`) are stripped
before the component sees them; they are instructions to Astro, not props.

## The footer

Imports and exports are hidden from the prose surface — an author has no use
for a caret inside an import statement, and a hidden-but-present node only
produces stray selections. The footer lists them as chips, expands to an
editable list, and adds or removes statements. It also flags capitalised JSX
names the document uses but never imports, with one click to add the import.

## Round-tripping

`mdastToDoc.ts` and `docToMdast.ts` are inverses, and `markdown.ts` picks
serializer options matching how this repo's MDX is already written (`-`
bullets, `**strong**`, `_emphasis_`, fenced code). A WYSIWYG round-trip always
normalizes formatting; the one visible change is that hard-wrapped paragraphs
come back as single lines, because mdast does not record soft wraps.

## Files

| File | |
| --- | --- |
| `index.js` | Plugin entrypoint; captures options, registers the field |
| `mdx.jsx` | The `plugin:mdx` field component |
| `MdxEditor.tsx` | Editor shell: state, serialization, theme, focus mode |
| `Toolbar.tsx` | Formatting toolbar and the insert-a-component menu |
| `EsmFooter.tsx` | The imports/exports footer |
| `MdxJsxView.tsx` | Node views for JSX elements, expressions, raw HTML |
| `PropsForm.tsx` | The inline props editor |
| `schema.ts` | ProseMirror schema — CommonMark plus the MDX nodes |
| `mdastToDoc.ts` / `docToMdast.ts` | mdast ⇄ ProseMirror |
| `markdown.ts` | mdast ⇄ MDX source |
| `esm.ts` | Import/export statement model |
| `componentRegistry.ts` | Resolves the `components` option to real components |
| `attributes.ts` | JSX attributes ⇄ props |
| `editor.css` | The whole surface; colors come from the design system |
