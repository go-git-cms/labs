/// <reference types="vite/client" />

import type { ComponentType } from "react";

/**
 * Resolving the `components` option to real React components.
 *
 * Plugin options are JSON-serialized into the generated `virtual:cms-plugins`
 * module by both hosts, so a component cannot be passed by reference. The
 * config names a module instead, and this module turns that name into a
 * lazily-imported component:
 *
 *   // cms.config.mjs
 *   plugins: [
 *     ["./plugins/plugin-mdx", {
 *       components: {
 *         Canvas: "Canvas",
 *         Code: { path: "Code", export: "default", props: [
 *           { name: "lang", type: "string", options: ["ts", "js", "go"] },
 *         ] },
 *       },
 *     }],
 *   ]
 *
 * Paths resolve inside this plugin's own `components/` directory, where each
 * file re-exports one of the project's components:
 *
 *   // plugins/plugin-mdx/components/Canvas.tsx
 *   export { default } from "../../../src/lib/@ui/Canvas";
 *
 * That indirection is not ceremony — it is the whole point. Vite has to see a
 * literal glob pattern, and it *resolves every file the pattern matches*, in
 * dev as well as in a build. Pointing the glob at the project's `src/` made
 * unrelated modules the editor's problem: one `.tsx` importing `astro:content`
 * or a package that isn't installed took the whole dev server down. A
 * directory the plugin owns contains the blast radius to files someone
 * deliberately put there.
 */

/** How a prop is edited in a component's inline form. */
export type PropType = "string" | "boolean" | "number" | "expression";

export type PropSpec = {
  name: string;
  type?: PropType;
  label?: string;
  /** Offer a fixed set of values instead of a free-text input. */
  options?: string[];
  required?: boolean;
};

export type ComponentSpec = {
  /** Module under `plugins/plugin-mdx/components/`, extension optional. */
  path: string;
  /** Named export to use. Defaults to the default export. */
  export?: string;
  /** Declared props, so the edit form can render typed inputs. */
  props?: PropSpec[];
};

export type ComponentsOption = Record<string, string | ComponentSpec>;

export type ResolvedComponent = {
  name: string;
  Component: ComponentType<any>;
  props: PropSpec[];
};

/**
 * Every JSX/TSX module under the project's `src/`, plus anything dropped in
 * this plugin's own `components/` directory, as lazy importers.
 *
 * The pattern has to be a literal — that is what lets Vite see it — so it
 * necessarily covers more files than the config names. Two consequences worth
 * knowing:
 *
 *   - In dev nothing is fetched until a document actually uses the component,
 *     so the extra reach costs nothing.
 *   - In a production CMS build every match becomes a build input. A `.tsx`
 *     under `src/` that cannot be bundled for the browser — one importing
 *     `astro:content`, say — will fail that build even if no document uses it.
 *     Wrap such a component in `plugins/plugin-mdx/components/` and point the
 *     config there instead.
 *
 * `.ts`/`.js` are deliberately excluded: components are `.jsx`/`.tsx`, and the
 * plain-module half of a project is where the un-bundleable data loaders live.
 */
type Loader = () => Promise<unknown>;

/** Every module in this plugin's components/ directory, as lazy importers. */
const modules = import.meta.glob("../components/**/*.{jsx,tsx}") as Record<string, Loader>;

/** Extensions tried, in order, when a configured path has none. */
const EXTENSIONS = ["", ".tsx", ".jsx", "/index.tsx", "/index.jsx"];

function normalize(spec: string | ComponentSpec): ComponentSpec {
  return typeof spec === "string" ? { path: spec } : spec;
}

/** The importer for a configured path, or null when nothing matches it. */
function resolveLoader(path: string): Loader | null {
  // Tolerate the ways someone might write it: "Canvas", "./Canvas.tsx",
  // "components/Canvas", "@plugin/components/Canvas".
  const clean = path
    .replace(/^@plugin\//, "")
    .replace(/^\.?\//, "")
    .replace(/^components\//, "");
  for (const ext of EXTENSIONS) {
    const loader = modules[`../components/${clean}${ext}`];
    if (loader) return loader;
  }
  return null;
}

/** Component modules that exist, for the "no module at …" warning. */
function available(): string[] {
  return Object.keys(modules).map((key) => key.replace("../components/", ""));
}

async function load(name: string, spec: ComponentSpec): Promise<ResolvedComponent | null> {
  const loader = resolveLoader(spec.path);
  if (!loader) {
    console.warn(
      `[plugin-mdx] component "${name}": no module "${spec.path}" in plugins/plugin-mdx/components/. ` +
        `Add one that re-exports it — export { default } from "../../../src/…" — then point the config at it. ` +
        `Available: ${available().join(", ") || "(none)"}`,
    );
    return null;
  }

  const mod = (await loader()) as Record<string, unknown>;
  const exported = mod[spec.export ?? "default"];
  if (typeof exported !== "function" && typeof exported !== "object") {
    console.warn(
      `[plugin-mdx] component "${name}": ${spec.path} has no ${spec.export ?? "default"} export that looks like a component.`,
    );
    return null;
  }

  return { name, Component: exported as ComponentType<any>, props: spec.props ?? [] };
}

/**
 * Load every configured component. One failure never blocks the rest — an
 * unresolved name simply falls back to the card representation in the editor.
 */
export async function loadComponents(
  components: ComponentsOption | undefined,
): Promise<Map<string, ResolvedComponent>> {
  const out = new Map<string, ResolvedComponent>();
  if (!components) return out;

  const loaded = await Promise.all(
    Object.entries(components).map(async ([name, spec]) => {
      try {
        return await load(name, normalize(spec));
      } catch (err) {
        console.warn(`[plugin-mdx] component "${name}" failed to load:`, err);
        return null;
      }
    }),
  );

  for (const entry of loaded) if (entry) out.set(entry.name, entry);
  return out;
}

/** Declared prop specs by component name, for the toolbar's insert menu. */
export function declaredProps(components: ComponentsOption | undefined, name: string): PropSpec[] {
  const spec = components?.[name];
  return spec ? normalize(spec).props ?? [] : [];
}
