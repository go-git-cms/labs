/// <reference types="vite/client" />

/**
 * Global CSS and JS the rendered components need.
 *
 * A component rendered without its stylesheet is not really rendered — the
 * site's classes have to exist in the editor too. Some components also want a
 * global script (a syntax highlighter, a web component registration) that
 * nothing imports directly.
 *
 * Two kinds of entry, told apart by shape:
 *
 *   - An **external URL** (`https://…`, `//…`) is injected as a tag on the
 *     document, exactly as a page would load it.
 *   - **Anything else** is a file in this plugin's `components/` directory and
 *     is imported, so the bundler processes and fingerprints it.
 *
 *   styles: ["site.css", "https://fonts.googleapis.com/css2?family=Inter"]
 *   scripts: ["register-elements.ts", "https://cdn.example.com/prism.js"]
 */

type Loader = () => Promise<unknown>;

const localStyles = import.meta.glob("../components/**/*.css") as Record<string, Loader>;
const localScripts = import.meta.glob("../components/**/*.{js,mjs,ts}") as Record<string, Loader>;

/** Injected once per document, however many editors mount. */
const injected = new Set<string>();

function isExternal(spec: string): boolean {
  return /^(https?:)?\/\//.test(spec);
}

function normalize(spec: string): string {
  return spec.replace(/^@plugin\//, "").replace(/^\.?\//, "").replace(/^components\//, "");
}

function findLocal(spec: string, modules: Record<string, Loader>, extensions: string[]): Loader | null {
  const clean = normalize(spec);
  for (const ext of ["", ...extensions]) {
    const loader = modules[`../components/${clean}${ext}`];
    if (loader) return loader;
  }
  return null;
}

/** A stylesheet link, resolved when the browser has it. */
function injectStyle(href: string): Promise<void> {
  if (typeof document === "undefined" || injected.has(href)) return Promise.resolve();
  injected.add(href);
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.mdxEditorAsset = "";
    // A stylesheet that fails to load is not worth blocking the editor for.
    link.onload = link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

function injectScript(src: string): Promise<void> {
  if (typeof document === "undefined" || injected.has(src)) return Promise.resolve();
  injected.add(src);
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = src;
    // Config order is the author's dependency order; keep it.
    script.async = false;
    script.dataset.mdxEditorAsset = "";
    script.onload = script.onerror = () => resolve();
    document.head.appendChild(script);
  });
}

async function loadOne(
  spec: string,
  kind: "style" | "script",
): Promise<void> {
  if (isExternal(spec)) {
    await (kind === "style" ? injectStyle(spec) : injectScript(spec));
    return;
  }

  const key = `${kind}:${spec}`;
  if (injected.has(key)) return;
  injected.add(key);

  const loader =
    kind === "style"
      ? findLocal(spec, localStyles, [".css"])
      : findLocal(spec, localScripts, [".ts", ".js", ".mjs"]);

  if (!loader) {
    console.warn(
      `[plugin-mdx] ${kind} "${spec}": not found in plugins/plugin-mdx/components/. ` +
        `Use a path relative to that directory, or an absolute URL to inject a tag instead.`,
    );
    return;
  }

  try {
    await loader();
  } catch (err) {
    console.warn(`[plugin-mdx] ${kind} "${spec}" failed to load:`, err);
  }
}

/**
 * Load every configured asset. Styles go in parallel; scripts run in config
 * order, because a script list is usually a dependency order.
 */
export async function loadAssets(styles: string[] = [], scripts: string[] = []): Promise<void> {
  await Promise.all(styles.map((spec) => loadOne(spec, "style")));
  for (const spec of scripts) await loadOne(spec, "script");
}
