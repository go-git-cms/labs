import { Schema, type DOMOutputSpec, type NodeSpec } from "prosemirror-model";
import { schema as basic } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";

/**
 * Everything MDX adds over CommonMark, as ProseMirror nodes.
 *
 * `mdxjsEsm` is deliberately absent: imports and exports are lifted out of the
 * document before it reaches the editor and live in the footer instead (see
 * esm.ts). What remains are the constructs an author actually points at — JSX
 * elements, expressions, and raw HTML.
 */

/** `{frontmatter.title}` in a block position, and raw HTML blocks. */
const mdxRaw: NodeSpec = {
  group: "block",
  atom: true,
  selectable: true,
  attrs: { value: { default: "" }, kind: { default: "expression" } },
  parseDOM: [
    {
      tag: "pre[data-mdx-raw]",
      getAttrs: (dom: HTMLElement) => ({
        value: dom.textContent ?? "",
        kind: dom.getAttribute("data-mdx-raw") || "expression",
      }),
    },
  ],
  toDOM: (node): DOMOutputSpec => [
    "pre",
    { "data-mdx-raw": node.attrs.kind, class: "mdx-raw" },
    node.attrs.value,
  ],
};

/**
 * `<Callout>…</Callout>` and `<Picture src={…} />`. Children stay editable, so
 * prose inside a component round-trips; attributes are held as opaque JSON and
 * edited through the node's own inline form rather than in the contenteditable.
 */
const mdxJsxFlow: NodeSpec = {
  group: "block",
  content: "block*",
  defining: true,
  isolating: true,
  attrs: { name: { default: "" }, attributes: { default: [] } },
  parseDOM: [
    {
      tag: "div[data-mdx-jsx]",
      contentElement: ".mdx-jsx__body",
      getAttrs: (dom: HTMLElement) => ({
        name: dom.getAttribute("data-mdx-jsx") ?? "",
        attributes: JSON.parse(dom.getAttribute("data-mdx-attrs") || "[]"),
      }),
    },
  ],
  toDOM: (node): DOMOutputSpec => [
    "div",
    {
      "data-mdx-jsx": node.attrs.name,
      "data-mdx-attrs": JSON.stringify(node.attrs.attributes),
      class: "mdx-jsx",
    },
    ["div", { class: "mdx-jsx__body" }, 0],
  ],
};

/**
 * The same element in a phrasing position — `some <Badge>text</Badge> here`.
 * Kept as a real inline node with content rather than an atom so its children
 * survive a round-trip.
 */
const mdxJsxText: NodeSpec = {
  inline: true,
  group: "inline",
  content: "inline*",
  attrs: { name: { default: "" }, attributes: { default: [] } },
  parseDOM: [
    {
      tag: "span[data-mdx-jsx-text]",
      contentElement: ".mdx-jsx-text__body",
      getAttrs: (dom: HTMLElement) => ({
        name: dom.getAttribute("data-mdx-jsx-text") ?? "",
        attributes: JSON.parse(dom.getAttribute("data-mdx-attrs") || "[]"),
      }),
    },
  ],
  toDOM: (node): DOMOutputSpec => [
    "span",
    {
      "data-mdx-jsx-text": node.attrs.name,
      "data-mdx-attrs": JSON.stringify(node.attrs.attributes),
      class: "mdx-jsx-text",
    },
    ["span", { class: "mdx-jsx-text__body" }, 0],
  ],
};

/** `{frontmatter.title}` mid-sentence. Opaque, so an atom. */
const mdxExpression: NodeSpec = {
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  attrs: { value: { default: "" } },
  parseDOM: [
    {
      tag: "code[data-mdx-expression]",
      getAttrs: (dom: HTMLElement) => ({ value: dom.getAttribute("data-mdx-expression") ?? "" }),
    },
  ],
  toDOM: (node): DOMOutputSpec => [
    "code",
    { "data-mdx-expression": node.attrs.value, class: "mdx-expression" },
    `{${node.attrs.value}}`,
  ],
};

const footnoteReference: NodeSpec = {
  inline: true,
  group: "inline",
  atom: true,
  attrs: { identifier: { default: "" }, label: { default: null } },
  parseDOM: [
    {
      tag: "sup[data-footnote-ref]",
      getAttrs: (dom: HTMLElement) => ({
        identifier: dom.getAttribute("data-footnote-ref") ?? "",
        label: dom.textContent,
      }),
    },
  ],
  toDOM: (node): DOMOutputSpec => [
    "sup",
    { "data-footnote-ref": node.attrs.identifier, class: "footnote-ref" },
    String(node.attrs.label ?? node.attrs.identifier),
  ],
};

const footnoteDefinition: NodeSpec = {
  group: "block",
  content: "block+",
  defining: true,
  attrs: { identifier: { default: "" }, label: { default: null } },
  parseDOM: [
    {
      tag: "aside[data-footnote-def]",
      contentElement: ".footnote-def__body",
      getAttrs: (dom: HTMLElement) => ({
        identifier: dom.getAttribute("data-footnote-def") ?? "",
      }),
    },
  ],
  toDOM: (node): DOMOutputSpec => [
    "aside",
    { "data-footnote-def": node.attrs.identifier, class: "footnote-def" },
    [
      "span",
      { class: "footnote-def__marker", contenteditable: "false" },
      String(node.attrs.label ?? node.attrs.identifier),
    ],
    ["div", { class: "footnote-def__body" }, 0],
  ],
};

/**
 * prosemirror-schema-basic covers paragraph / heading / blockquote /
 * horizontal_rule / code_block / image / hard_break, plus the em, strong,
 * code, and link marks — the mdast core minus lists. code_block gains a `lang`
 * attribute so a fence's language survives the round-trip.
 */
const codeBlock: NodeSpec = {
  ...(basic.spec.nodes.get("code_block") as NodeSpec),
  attrs: { lang: { default: null } },
  parseDOM: [
    {
      tag: "pre",
      preserveWhitespace: "full",
      getAttrs: (dom: HTMLElement) => ({ lang: dom.getAttribute("data-lang") }),
    },
  ],
  toDOM: (node): DOMOutputSpec => [
    "pre",
    node.attrs.lang ? { "data-lang": node.attrs.lang } : {},
    ["code", 0],
  ],
};

export const schema = new Schema({
  nodes: addListNodes(basic.spec.nodes, "paragraph block*", "block")
    .update("code_block", codeBlock)
    .append({
      mdx_raw: mdxRaw,
      mdx_jsx_flow: mdxJsxFlow,
      mdx_jsx_text: mdxJsxText,
      mdx_expression: mdxExpression,
      footnote_definition: footnoteDefinition,
      footnote_reference: footnoteReference,
    }),
  marks: basic.spec.marks,
});
