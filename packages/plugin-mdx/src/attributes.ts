import type { JsxAttribute } from "./mdastToDoc";

/** The tag-line rendering of one attribute: `src="x"`, `n={1}`, `{...rest}`. */
export function formatAttribute(attr: JsxAttribute): string {
  if (attr.name === null) return `{${attr.expression}}`;
  if (attr.expression !== undefined) return `${attr.name}={${attr.expression}}`;
  return attr.value === true ? attr.name : `${attr.name}="${attr.value}"`;
}

/**
 * Names shadowed to `undefined` while evaluating an expression, so a prop
 * cannot reach the page, the network, or the module system on its way to
 * being rendered.
 */
const SHADOWED = [
  "window",
  "document",
  "globalThis",
  "self",
  "top",
  "parent",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "navigator",
  "location",
  "history",
  "process",
  "require",
  "module",
  "exports",
  "Function",
];

/**
 * The value of an attribute expression, when it has one.
 *
 * `{['npm', 'yarn']}` is a real prop and the component should get it, so the
 * expression is evaluated — in strict mode, with the browser's ambient objects
 * shadowed to `undefined`. What that leaves is arithmetic over literals.
 *
 * `{generateUrl({ title: frontmatter.title })}` is a different thing: it reads
 * the document's own imports and frontmatter, neither of which exists in the
 * editor. Those identifiers are simply not bound, so evaluation throws a
 * ReferenceError and the attribute is reported unresolved rather than guessed
 * at. Either way the source text is never modified.
 */
export function parseLiteral(expression: string): { ok: true; value: unknown } | { ok: false } {
  const source = expression.trim();
  if (!source) return { ok: false };

  // Fast paths for the shapes that dominate, so the common case never
  // reaches the evaluator.
  if (source === "true") return { ok: true, value: true };
  if (source === "false") return { ok: true, value: false };
  if (source === "null") return { ok: true, value: null };
  if (source === "undefined") return { ok: true, value: undefined };

  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(source)) return { ok: true, value: Number(source) };

  // A single-quoted string, or a template literal with no interpolation.
  const quoted = /^'((?:[^'\\]|\\.)*)'$/.exec(source) ?? /^`((?:[^`\\$]|\\.)*)`$/.exec(source);
  if (quoted) return { ok: true, value: quoted[1].replace(/\\(.)/g, "$1") };

  try {
    return { ok: true, value: JSON.parse(source) };
  } catch {
    /* not JSON — fall through to evaluation */
  }

  try {
    // eslint-disable-next-line no-new-func
    const evaluate = new Function(...SHADOWED, `"use strict"; return (${source});`);
    return { ok: true, value: evaluate(...SHADOWED.map(() => undefined)) };
  } catch {
    return { ok: false };
  }
}

export type ResolvedProps = {
  props: Record<string, unknown>;
  /** Attribute names whose expression could not be resolved to a literal. */
  unresolved: string[];
};

/** Turn stored attributes into props for a live preview. */
export function attributesToProps(attributes: JsxAttribute[] = []): ResolvedProps {
  const props: Record<string, unknown> = {};
  const unresolved: string[] = [];

  for (const attr of attributes) {
    if (attr.name === null) {
      unresolved.push("…spread");
      continue;
    }
    if (attr.expression !== undefined) {
      const parsed = parseLiteral(attr.expression);
      if (parsed.ok) props[attr.name] = parsed.value;
      else unresolved.push(attr.name);
      continue;
    }
    props[attr.name] = attr.value === true ? true : attr.value;
  }

  return { props, unresolved };
}

/** `class` is what MDX authors write; React wants `className`. */
export function toReactProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    // Astro template directives (`client:idle`, `set:html`) are build-time
    // instructions to Astro, not props the component ever receives.
    if (/^(client|set|transition|is|server):/.test(key)) continue;
    if (key === "class") out.className = value;
    else if (key === "for") out.htmlFor = value;
    else out[key] = value;
  }
  return out;
}
