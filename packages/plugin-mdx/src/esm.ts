/**
 * The document's `import` / `export` statements.
 *
 * These never enter the ProseMirror doc: an author editing prose has no use
 * for a cursor inside `import Foo from "./Foo"`, and a hidden-but-present node
 * only produces stray selections. They are split off the mdast tree at parse
 * time, owned by the footer as plain state, and written back to the top of the
 * tree on serialize.
 */

export type EsmKind = "import" | "export";

export type EsmEntry = {
  /** Stable across edits so React keys and the "editing" cursor survive. */
  id: string;
  kind: EsmKind;
  /** Raw source of exactly one statement. */
  value: string;
};

let counter = 0;
const nextId = () => `esm-${++counter}`;

export function makeEntry(value: string): EsmEntry {
  return { id: nextId(), kind: classify(value), value: value.trim() };
}

function classify(value: string): EsmKind {
  return /^\s*export\b/.test(value) ? "export" : "import";
}

/** Re-classify after an edit while keeping the entry's identity. */
export function withValue(entry: EsmEntry, value: string): EsmEntry {
  return { ...entry, value: value.trim(), kind: classify(value) };
}

/* ------------------------------------------------------------- splitting */

/**
 * One `mdxjsEsm` node holds every consecutive import/export line, so a
 * document's whole import block usually arrives as a single blob. Split it
 * into statements on newlines that sit at bracket depth zero and outside a
 * string, which keeps multi-line named imports intact.
 */
export function splitStatements(source: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "\n" && depth <= 0) {
      const chunk = source.slice(start, i).trim();
      if (chunk) out.push(chunk);
      start = i + 1;
    }
  }

  const tail = source.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/* -------------------------------------------------------------- summary */

export type EsmSummary = {
  /** Bound names, for the chip label. */
  names: string[];
  /** Module specifier, when there is one. */
  from: string | null;
};

/**
 * A compact reading of a statement for the footer chip. Deliberately regex-
 * shallow: this labels a chip, and the raw source stays one click away.
 */
export function summarize(value: string): EsmSummary {
  const from = /\bfrom\s*['"]([^'"]+)['"]/.exec(value)?.[1] ?? sideEffectSource(value);

  if (/^\s*export\b/.test(value)) {
    return { names: exportNames(value), from };
  }

  const names: string[] = [];
  const clause = /^\s*import\s+([\s\S]*?)\s+from\b/.exec(value)?.[1];
  if (clause) {
    const named = /\{([\s\S]*?)\}/.exec(clause)?.[1];
    const bare = clause.replace(/\{[\s\S]*?\}/, "").replace(/,/g, " ").trim();
    if (bare) names.push(...bare.split(/\s+/).filter(Boolean));
    if (named) {
      names.push(
        ...named
          .split(",")
          .map((part) => part.trim().split(/\s+as\s+/).pop()!.trim())
          .filter(Boolean),
      );
    }
  }
  return { names, from };
}

function sideEffectSource(value: string): string | null {
  return /^\s*import\s*['"]([^'"]+)['"]/.exec(value)?.[1] ?? null;
}

function exportNames(value: string): string[] {
  if (/^\s*export\s+default\b/.test(value)) return ["default"];
  const braced = /^\s*export\s*\{([\s\S]*?)\}/.exec(value)?.[1];
  if (braced) {
    return braced
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/).pop()!.trim())
      .filter(Boolean);
  }
  const declared = /^\s*export\s+(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/.exec(value)?.[1];
  return declared ? [declared] : [];
}

/** Every identifier the document's imports bring into scope. */
export function importedNames(entries: EsmEntry[]): Set<string> {
  const set = new Set<string>();
  for (const entry of entries) {
    for (const name of summarize(entry.value).names) set.add(name);
  }
  return set;
}
