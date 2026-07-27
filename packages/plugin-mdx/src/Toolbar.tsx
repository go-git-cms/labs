import { useEditorEventCallback, useEditorState } from "@handlewithcare/react-prosemirror";
import { setBlockType, toggleMark, wrapIn } from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import type { MarkType, NodeType, Schema } from "prosemirror-model";
import { wrapInList } from "prosemirror-schema-list";
import type { Command, EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import React, { useEffect, useMemo, useRef, useState } from "react";

import { useMdxEditor } from "./context";
import {
  BoldIcon,
  BulletListIcon,
  ChevronIcon,
  CodeBlockIcon,
  CodeIcon,
  ComponentIcon,
  ExpandIcon,
  H1Icon,
  H2Icon,
  H3Icon,
  ItalicIcon,
  LinkIcon,
  OrderedListIcon,
  QuoteIcon,
  RedoIcon,
  RuleIcon,
  UndoIcon,
} from "./icons";

/* ------------------------------------------------------------ predicates */

function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

function blockActive(state: EditorState, type: NodeType, attrs: Record<string, unknown> = {}): boolean {
  const { $from, to } = state.selection;
  return to <= $from.end() && $from.parent.hasMarkup(type, attrs);
}

/** True when any ancestor is a node of the given type — lists and blockquotes. */
function ancestorActive(state: EditorState, type: NodeType): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === type) return true;
  }
  return false;
}

/* ---------------------------------------------------------------- commands */

const toggleHeading =
  (schema: Schema, level: number): Command =>
  (state, dispatch, view) => {
    const { heading, paragraph } = schema.nodes;
    const cmd = blockActive(state, heading, { level })
      ? setBlockType(paragraph)
      : setBlockType(heading, { level });
    return cmd(state, dispatch, view);
  };

const insertRule =
  (schema: Schema): Command =>
  (state, dispatch) => {
    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create()).scrollIntoView());
    }
    return true;
  };

/** Prompt-driven link: apply to the selection, or strip an existing one. */
const editLink =
  (schema: Schema): Command =>
  (state, dispatch, view) => {
    const type = schema.marks.link;
    if (markActive(state, type)) return toggleMark(type)(state, dispatch, view);
    if (state.selection.empty) return false;
    if (!dispatch) return true;
    const href = typeof window === "undefined" ? null : window.prompt("Link URL");
    if (!href) return true;
    return toggleMark(type, { href, title: null })(state, dispatch, view);
  };

/* ----------------------------------------------------------------- items */

type ToolItem = {
  key: string;
  title: string;
  Icon: React.ComponentType<{ size?: number }>;
  command: Command;
  isActive?: (state: EditorState) => boolean;
};

function buildGroups(schema: Schema): ToolItem[][] {
  const groups: ToolItem[][] = [];
  const { strong, em, code, link } = schema.marks;
  const nodes = schema.nodes;

  groups.push([
    { key: "undo", title: "Undo (⌘Z)", Icon: UndoIcon, command: undo },
    { key: "redo", title: "Redo (⇧⌘Z)", Icon: RedoIcon, command: redo },
  ]);

  groups.push([
    { key: "bold", title: "Bold (⌘B)", Icon: BoldIcon, command: toggleMark(strong), isActive: (s) => markActive(s, strong) },
    { key: "italic", title: "Italic (⌘I)", Icon: ItalicIcon, command: toggleMark(em), isActive: (s) => markActive(s, em) },
    { key: "code", title: "Inline code", Icon: CodeIcon, command: toggleMark(code), isActive: (s) => markActive(s, code) },
    { key: "link", title: "Link", Icon: LinkIcon, command: editLink(schema), isActive: (s) => markActive(s, link) },
  ]);

  groups.push([
    { key: "h1", title: "Heading 1", Icon: H1Icon, command: toggleHeading(schema, 1), isActive: (s) => blockActive(s, nodes.heading, { level: 1 }) },
    { key: "h2", title: "Heading 2", Icon: H2Icon, command: toggleHeading(schema, 2), isActive: (s) => blockActive(s, nodes.heading, { level: 2 }) },
    { key: "h3", title: "Heading 3", Icon: H3Icon, command: toggleHeading(schema, 3), isActive: (s) => blockActive(s, nodes.heading, { level: 3 }) },
  ]);

  groups.push([
    { key: "ul", title: "Bullet list", Icon: BulletListIcon, command: wrapInList(nodes.bullet_list), isActive: (s) => ancestorActive(s, nodes.bullet_list) },
    { key: "ol", title: "Numbered list", Icon: OrderedListIcon, command: wrapInList(nodes.ordered_list), isActive: (s) => ancestorActive(s, nodes.ordered_list) },
    { key: "quote", title: "Blockquote", Icon: QuoteIcon, command: wrapIn(nodes.blockquote), isActive: (s) => ancestorActive(s, nodes.blockquote) },
    { key: "pre", title: "Code block", Icon: CodeBlockIcon, command: setBlockType(nodes.code_block), isActive: (s) => blockActive(s, nodes.code_block) },
    { key: "hr", title: "Divider", Icon: RuleIcon, command: insertRule(schema) },
  ]);

  return groups;
}

function ToolButton({ item }: { item: ToolItem }) {
  const state = useEditorState();
  const run = useEditorEventCallback((view: EditorView, command: Command) => {
    command(view.state, view.dispatch, view);
    view.focus();
  });
  const active = item.isActive?.(state) ?? false;
  const enabled = item.command(state); // dry run: whether the command applies
  return (
    <button
      type="button"
      className="cms-editor__tool"
      aria-pressed={active}
      aria-label={item.title}
      title={item.title}
      disabled={!enabled}
      // Keep the editor selection while clicking the toolbar.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => run(item.command)}
    >
      <item.Icon />
    </button>
  );
}

/* --------------------------------------------------------- insert a component */

function InsertMenu({ schema, onInserted }: { schema: Schema; onInserted: (pos: number) => void }) {
  const { components } = useMdxEditor();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const insert = useEditorEventCallback((view: EditorView, name: string) => {
    const type = schema.nodes.mdx_jsx_flow;
    const node = type.create({ name, attributes: [] });
    const from = view.state.selection.from;
    const tr = view.state.tr.replaceSelectionWith(node).scrollIntoView();

    // Find where it landed, so the new node can open its form on mount.
    const near = tr.mapping.map(from);
    const span = node.nodeSize + 2;
    let at: number | null = null;
    tr.doc.nodesBetween(
      Math.max(0, near - span),
      Math.min(tr.doc.content.size, near + span),
      (candidate, pos) => {
        if (at === null && candidate.type === type && candidate.attrs.name === name) at = pos;
      },
    );

    view.dispatch(tr);
    if (at !== null) onInserted(at);
    view.focus();
  });

  const names = [...components.keys()].sort();

  const choose = (name: string) => {
    setOpen(false);
    insert(name);
  };

  const custom = () => {
    setOpen(false);
    const name = typeof window === "undefined" ? null : window.prompt("Component name", "");
    if (name?.trim()) insert(name.trim());
  };

  return (
    <div className="cms-editor__menu" ref={wrapRef}>
      <button
        type="button"
        className="cms-editor__tool"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Insert a component"
        aria-label="Insert a component"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((current) => !current)}
      >
        <ComponentIcon />
        <ChevronIcon open={open} size={11} />
      </button>
      {open ? (
        <div className="cms-editor__menu-pop" role="menu">
          {names.length ? (
            names.map((name) => (
              <button key={name} type="button" role="menuitem" className="cms-editor__menu-item" onClick={() => choose(name)}>
                <span className="cms-editor__menu-name">{name}</span>
                <span className="cms-editor__menu-note">live</span>
              </button>
            ))
          ) : (
            <p className="cms-editor__menu-empty">
              No components configured. Add them to the plugin's <code>components</code> option.
            </p>
          )}
          <button type="button" role="menuitem" className="cms-editor__menu-item" onClick={custom}>
            <span className="cms-editor__menu-name">Other…</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- toolbar */

export function Toolbar({
  schema,
  readOnly,
  expanded,
  onToggleExpand,
  onInserted,
}: {
  schema: Schema;
  readOnly: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onInserted: (pos: number) => void;
}) {
  const groups = useMemo(() => buildGroups(schema), [schema]);

  return (
    <div className="cms-editor__toolbar" role="toolbar" aria-label="Formatting">
      {readOnly ? null : (
        <>
          {groups.map((group, index) => (
            <React.Fragment key={index}>
              {index > 0 ? <span className="cms-editor__toolbar-sep" /> : null}
              {group.map((item) => (
                <ToolButton key={item.key} item={item} />
              ))}
            </React.Fragment>
          ))}
          <span className="cms-editor__toolbar-sep" />
          <InsertMenu schema={schema} onInserted={onInserted} />
        </>
      )}
      <button
        type="button"
        className="cms-editor__tool cms-editor__tool--expand"
        onClick={onToggleExpand}
        aria-label={expanded ? "Exit focus mode" : "Expand to focus mode"}
        title={expanded ? "Exit focus mode (Esc)" : "Focus mode"}
      >
        <ExpandIcon expanded={expanded} />
      </button>
    </div>
  );
}
