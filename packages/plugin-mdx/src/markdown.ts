import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { mdxFromMarkdown, mdxToMarkdown } from "mdast-util-mdx";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";
import { mdxjs } from "micromark-extension-mdxjs";

type Mdast = { type: string; [key: string]: any };

export function parseMdx(source: string): Mdast {
  return fromMarkdown(source ?? "", {
    extensions: [mdxjs(), gfm()],
    mdastExtensions: [mdxFromMarkdown(), gfmFromMarkdown()],
  }) as Mdast;
}

/**
 * Serializer options chosen to match how this repo's MDX is already written —
 * `-` bullets, `**strong**`, `_emphasis_`, fenced code. A WYSIWYG round-trip
 * always normalizes formatting; matching the house style keeps that from
 * showing up as a diff on every save.
 */
export function serializeMdx(tree: Mdast): string {
  return toMarkdown(tree as never, {
    extensions: [mdxToMarkdown(), gfmToMarkdown()],
    bullet: "-",
    emphasis: "_",
    strong: "*",
    fences: true,
    rule: "-",
    listItemIndent: "one",
    resourceLink: false,
  });
}
