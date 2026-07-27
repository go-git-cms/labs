import type { Node as PMNode, Schema } from "prosemirror-model";

import { makeEntry, splitStatements, type EsmEntry } from "./esm";

/** Loosely typed on purpose — mdast + mdx extensions, positions and all. */
type Mdast = { type: string; [key: string]: any };

type MarkJSON = { type: string; attrs?: Record<string, unknown> };
type NodeJSON = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: NodeJSON[];
  marks?: MarkJSON[];
  text?: string;
};

export type ParsedDocument = {
  doc: PMNode;
  /** Imports and exports, lifted out of the doc for the footer to own. */
  esm: EsmEntry[];
};

/** Build an editable doc from a parsed MDX tree. */
export function mdastToDoc(schema: Schema, tree: Mdast): ParsedDocument {
  const esm: EsmEntry[] = [];
  const body: Mdast[] = [];

  for (const node of tree.children ?? []) {
    if (node.type === "mdxjsEsm") {
      for (const statement of splitStatements(node.value ?? "")) esm.push(makeEntry(statement));
    } else {
      body.push(node);
    }
  }

  const doc = schema.nodeFromJSON({ type: "doc", content: nonEmpty(blocks(body)) });
  doc.check(); // loud, early failure if a mapping produces invalid content
  return { doc, esm };
}

/* ---------------------------------------------------------------- blocks */

function blocks(nodes: Mdast[]): NodeJSON[] {
  return nodes.flatMap(block);
}

function block(node: Mdast): NodeJSON[] {
  switch (node.type) {
    case "paragraph":
      return [{ type: "paragraph", content: inlines(node.children) }];

    case "heading":
      return [
        {
          type: "heading",
          attrs: { level: Math.min(6, Math.max(1, node.depth ?? 1)) },
          content: inlines(node.children),
        },
      ];

    case "blockquote":
      return [{ type: "blockquote", content: nonEmpty(blocks(node.children ?? [])) }];

    case "list":
      return [
        {
          type: node.ordered ? "ordered_list" : "bullet_list",
          attrs: node.ordered ? { order: node.start ?? 1 } : undefined,
          content: (node.children ?? []).flatMap(listItem),
        },
      ];

    case "thematicBreak":
      return [{ type: "horizontal_rule" }];

    case "code":
      // Verbatim: a code block's newlines are its content, not source wrapping.
      return [{ type: "code_block", attrs: { lang: node.lang ?? null }, content: rawText(node.value) }];

    case "footnoteDefinition":
      return [
        {
          type: "footnote_definition",
          attrs: { identifier: node.identifier, label: node.label ?? node.identifier },
          content: nonEmpty(blocks(node.children ?? [])),
        },
      ];

    case "mdxFlowExpression":
      return [{ type: "mdx_raw", attrs: { kind: "expression", value: node.value ?? "" } }];

    case "html":
      return [{ type: "mdx_raw", attrs: { kind: "html", value: node.value ?? "" } }];

    case "mdxJsxFlowElement":
      return [
        {
          type: "mdx_jsx_flow",
          attrs: { name: node.name ?? "", attributes: jsxAttributes(node.attributes) },
          content: blocks(node.children ?? []),
        },
      ];

    default:
      console.warn(`[mdastToDoc] unhandled block node: ${node.type}`);
      if (Array.isArray(node.children)) return blocks(node.children);
      return [{ type: "paragraph", content: text(node.value, [{ type: "code" }]) }];
  }
}

function listItem(node: Mdast): NodeJSON[] {
  if (node.type !== "listItem") return block(node);
  const content = blocks(node.children ?? []);
  // list_item content is "paragraph block*", so a nested list can't come first
  if (content[0]?.type !== "paragraph") content.unshift({ type: "paragraph" });
  return [{ type: "list_item", content }];
}

/* ---------------------------------------------------------------- inlines */

function inlines(nodes: Mdast[] = [], marks: MarkJSON[] = []): NodeJSON[] {
  return nodes.flatMap((node) => inline(node, marks));
}

function inline(node: Mdast, marks: MarkJSON[]): NodeJSON[] {
  switch (node.type) {
    case "text":
      return text(node.value, marks);

    case "inlineCode":
      return text(node.value, withMark(marks, { type: "code" }));

    case "strong":
      return inlines(node.children, withMark(marks, { type: "strong" }));

    case "emphasis":
      return inlines(node.children, withMark(marks, { type: "em" }));

    case "link":
      return inlines(
        node.children,
        withMark(marks, {
          type: "link",
          attrs: { href: node.url ?? "", title: node.title ?? null },
        }),
      );

    case "break":
      return [{ type: "hard_break", marks }];

    case "image":
      return [
        {
          type: "image",
          attrs: { src: node.url ?? "", alt: node.alt ?? null, title: node.title ?? null },
          marks,
        },
      ];

    case "footnoteReference":
      return [
        {
          type: "footnote_reference",
          attrs: { identifier: node.identifier, label: node.label ?? node.identifier },
        },
      ];

    case "mdxTextExpression":
      return [{ type: "mdx_expression", attrs: { value: node.value ?? "" } }];

    case "mdxJsxTextElement":
      return [
        {
          type: "mdx_jsx_text",
          attrs: { name: node.name ?? "", attributes: jsxAttributes(node.attributes) },
          content: inlines(node.children, marks),
        },
      ];

    default:
      console.warn(`[mdastToDoc] unhandled inline node: ${node.type}`);
      if (Array.isArray(node.children)) return inlines(node.children, marks);
      return text(node.value, marks);
  }
}

/* ---------------------------------------------------------------- helpers */

/**
 * mdast keeps the source's hard wraps inside text values. Markdown renders
 * those as a single space, and ProseMirror rejects empty text nodes — so
 * collapse first, then drop anything that comes out empty.
 */
function text(value: unknown, marks: MarkJSON[] = []): NodeJSON[] {
  if (typeof value !== "string") return [];
  const collapsed = value.replace(/[ \t]*\r?\n[ \t]*/g, " ");
  return collapsed ? [{ type: "text", text: collapsed, marks }] : [];
}

/** Text kept exactly as written — code blocks, where whitespace is content. */
function rawText(value: unknown): NodeJSON[] {
  return typeof value === "string" && value ? [{ type: "text", text: value }] : [];
}

function withMark(marks: MarkJSON[], mark: MarkJSON): MarkJSON[] {
  return marks.some((m) => m.type === mark.type) ? marks : [...marks, mark];
}

/** `block+` content can't be empty; give it something to put a cursor in. */
function nonEmpty(content: NodeJSON[]): NodeJSON[] {
  return content.length ? content : [{ type: "paragraph" }];
}

/** One JSX attribute, flattened to JSON so it survives `node.toJSON()`. */
export type JsxAttribute = {
  /** `null` for a spread — `{...props}`. */
  name: string | null;
  /** A literal string, or `true` for the `<Foo disabled />` shorthand. */
  value?: string | true;
  /** Raw source of `name={…}`, or of the spread itself. */
  expression?: string;
};

/**
 * Flatten MDX JSX attributes into plain JSON. String attrs keep their value;
 * expression attrs keep their raw source text.
 */
export function jsxAttributes(attributes: Mdast[] = []): JsxAttribute[] {
  return attributes.map((attr) => {
    if (attr.type === "mdxJsxExpressionAttribute") {
      return { name: null, expression: attr.value ?? "" };
    }
    if (attr.value && typeof attr.value === "object") {
      return { name: attr.name, expression: attr.value.value ?? "" };
    }
    return { name: attr.name, value: attr.value ?? true };
  });
}
