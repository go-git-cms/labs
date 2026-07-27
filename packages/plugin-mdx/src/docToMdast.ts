import type { Mark, Node as PMNode } from "prosemirror-model";

import type { EsmEntry } from "./esm";
import type { JsxAttribute } from "./mdastToDoc";

/** Loosely typed on purpose — mdast + mdx extensions. */
type Mdast = { type: string; [key: string]: any };

/**
 * The inverse of mdastToDoc. Imports and exports are re-attached at the top of
 * the tree in footer order, which is where MDX wants them and where they were
 * lifted from.
 */
export function docToMdast(doc: PMNode, esm: EsmEntry[]): Mdast {
  // One node holding every statement, not one node each: mdast puts a blank
  // line between blocks, and an import block is conventionally contiguous.
  const statements = esm.map((entry) => entry.value.trim()).filter(Boolean);
  const head = statements.length ? [{ type: "mdxjsEsm", value: statements.join("\n") }] : [];
  return { type: "root", children: [...head, ...childBlocks(doc)] };
}

/* ---------------------------------------------------------------- blocks */

function childBlocks(parent: PMNode): Mdast[] {
  const out: Mdast[] = [];
  parent.forEach((child) => out.push(...block(child)));
  return out;
}

function block(node: PMNode): Mdast[] {
  switch (node.type.name) {
    case "paragraph":
      return [{ type: "paragraph", children: childInlines(node) }];

    case "heading":
      return [{ type: "heading", depth: node.attrs.level ?? 1, children: childInlines(node) }];

    case "blockquote":
      return [{ type: "blockquote", children: childBlocks(node) }];

    case "bullet_list":
      return [{ type: "list", ordered: false, spread: false, children: childBlocks(node) }];

    case "ordered_list":
      return [
        {
          type: "list",
          ordered: true,
          start: node.attrs.order ?? 1,
          spread: false,
          children: childBlocks(node),
        },
      ];

    case "list_item":
      return [{ type: "listItem", spread: false, checked: null, children: childBlocks(node) }];

    case "horizontal_rule":
      return [{ type: "thematicBreak" }];

    case "code_block":
      return [{ type: "code", lang: node.attrs.lang ?? null, meta: null, value: node.textContent }];

    case "footnote_definition":
      return [
        {
          type: "footnoteDefinition",
          identifier: node.attrs.identifier,
          label: node.attrs.label ?? node.attrs.identifier,
          children: childBlocks(node),
        },
      ];

    case "mdx_raw":
      return node.attrs.kind === "html"
        ? [{ type: "html", value: node.attrs.value }]
        : [{ type: "mdxFlowExpression", value: node.attrs.value }];

    case "mdx_jsx_flow":
      return [
        {
          type: "mdxJsxFlowElement",
          name: node.attrs.name || null,
          attributes: toMdastAttributes(node.attrs.attributes),
          children: childBlocks(node),
        },
      ];

    default:
      console.warn(`[docToMdast] unhandled block node: ${node.type.name}`);
      return [{ type: "paragraph", children: childInlines(node) }];
  }
}

/* --------------------------------------------------------------- inlines */

function childInlines(parent: PMNode): Mdast[] {
  const out: Mdast[] = [];
  parent.forEach((child) => out.push(...inline(child)));
  return out;
}

function inline(node: PMNode): Mdast[] {
  switch (node.type.name) {
    case "text":
      return [applyMarks(textOrCode(node), node.marks)];

    case "hard_break":
      return [{ type: "break" }];

    case "image":
      return [
        applyMarks(
          {
            type: "image",
            url: node.attrs.src ?? "",
            alt: node.attrs.alt ?? null,
            title: node.attrs.title ?? null,
          },
          node.marks,
        ),
      ];

    case "footnote_reference":
      return [
        {
          type: "footnoteReference",
          identifier: node.attrs.identifier,
          label: node.attrs.label ?? node.attrs.identifier,
        },
      ];

    case "mdx_expression":
      return [{ type: "mdxTextExpression", value: node.attrs.value ?? "" }];

    case "mdx_jsx_text":
      return [
        {
          type: "mdxJsxTextElement",
          name: node.attrs.name || null,
          attributes: toMdastAttributes(node.attrs.attributes),
          children: childInlines(node),
        },
      ];

    default:
      console.warn(`[docToMdast] unhandled inline node: ${node.type.name}`);
      return node.isText ? [{ type: "text", value: node.text ?? "" }] : [];
  }
}

/** The `code` mark has no mdast wrapper — it *is* the node. */
function textOrCode(node: PMNode): Mdast {
  const value = node.text ?? "";
  return node.marks.some((m) => m.type.name === "code")
    ? { type: "inlineCode", value }
    : { type: "text", value };
}

/** Innermost to outermost: emphasis, strong, then link. */
function applyMarks(base: Mdast, marks: readonly Mark[]): Mdast {
  const has = (name: string) => marks.some((m) => m.type.name === name);
  let out = base;
  if (has("em")) out = { type: "emphasis", children: [out] };
  if (has("strong")) out = { type: "strong", children: [out] };
  const link = marks.find((m) => m.type.name === "link");
  if (link) {
    out = {
      type: "link",
      url: link.attrs.href ?? "",
      title: link.attrs.title ?? null,
      children: [out],
    };
  }
  return out;
}

/* ------------------------------------------------------------ attributes */

/** The inverse of mdastToDoc's `jsxAttributes`. */
export function toMdastAttributes(attributes: JsxAttribute[] = []): Mdast[] {
  return attributes.map((attr) => {
    if (attr.name === null) {
      return { type: "mdxJsxExpressionAttribute", value: attr.expression ?? "" };
    }
    if (attr.expression !== undefined) {
      return {
        type: "mdxJsxAttribute",
        name: attr.name,
        value: { type: "mdxJsxAttributeValueExpression", value: attr.expression },
      };
    }
    // mdast spells the `<Foo disabled />` shorthand as a null value.
    return { type: "mdxJsxAttribute", name: attr.name, value: attr.value === true ? null : attr.value };
  });
}
