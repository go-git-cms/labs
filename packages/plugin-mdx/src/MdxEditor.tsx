import "prosemirror-view/style/prosemirror.css";
import "./editor.css";

import { ProseMirror, ProseMirrorDoc, reactKeys } from "@handlewithcare/react-prosemirror";
import { useTheme } from "@go-git-cms/design-system";
import { baseKeymap, chainCommands, createParagraphNear, exitCode } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { liftListItem, splitListItem } from "prosemirror-schema-list";
import { EditorState, TextSelection, type Command, type Transaction } from "prosemirror-state";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadAssets } from "./assets";
import { loadComponents, type ComponentsOption, type ResolvedComponent } from "./componentRegistry";
import { MdxEditorContext } from "./context";
import { docToMdast } from "./docToMdast";
import { EsmFooter } from "./EsmFooter";
import { importedNames, type EsmEntry } from "./esm";
import { serializeMdx, parseMdx } from "./markdown";
import { mdastToDoc } from "./mdastToDoc";
import { MdxExpressionView, MdxJsxFlowView, MdxJsxTextView, MdxRawView } from "./MdxJsxView";
import { schema } from "./schema";
import { Toolbar } from "./Toolbar";

// Must be a stable reference — defined outside the component.
const nodeViewComponents = {
  mdx_raw: MdxRawView,
  mdx_jsx_flow: MdxJsxFlowView,
  mdx_jsx_text: MdxJsxTextView,
  mdx_expression: MdxExpressionView,
};

/**
 * Escape a component's body. `mdx_jsx_flow` is isolating, so without this a
 * caret inside `<Canvas>…</Canvas>` has no keyboard route back out to the
 * document.
 */
const exitBlock: Command = (state, dispatch) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type !== schema.nodes.mdx_jsx_flow) continue;
    if (!dispatch) return true;
    const after = $from.after(depth);
    const tr = state.tr.insert(after, schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
    dispatch(tr.scrollIntoView());
    return true;
  }
  return false;
};

const plugins = [
  // Required by React ProseMirror.
  reactKeys(),
  history(),
  keymap({ "Mod-z": undo, "Shift-Mod-z": redo, "Mod-y": redo }),
  keymap({
    Enter: splitListItem(schema.nodes.list_item),
    "Shift-Tab": liftListItem(schema.nodes.list_item),
    "Mod-Enter": chainCommands(exitBlock, exitCode, createParagraphNear),
  }),
  keymap(baseKeymap),
];

export type MdxEditorProps = {
  value: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
  debounceMs?: number;
  components?: ComponentsOption;
  /** Global CSS the rendered components need. See assets.ts. */
  styles?: string[];
  /** Global JS the rendered components need. See assets.ts. */
  scripts?: string[];
};

export function MdxEditor({
  value,
  onChange,
  readOnly = false,
  debounceMs = 200,
  components: componentsOption,
  styles,
  scripts,
}: MdxEditorProps) {
  const theme = useTheme();

  /* ------------------------------------------------- document + esm state */

  const parsed = useMemo(() => mdastToDoc(schema, parseMdx(value)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState(() => EditorState.create({ doc: parsed.doc, plugins }));
  const [esm, setEsm] = useState<EsmEntry[]>(parsed.esm);

  // What the editor believes the field currently holds, so an incoming `value`
  // can be told apart from an echo of our own last emit.
  const emitted = useRef(value);
  // The doc/esm pair the current `value` was built from. Anything else is an
  // edit that has to be serialized back out.
  const serialized = useRef({ doc: parsed.doc, esm: parsed.esm });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emit = useCallback(
    (doc: typeof state.doc, entries: EsmEntry[]) => {
      if (!onChange || readOnly) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const markdown = serializeMdx(docToMdast(doc, entries));
        emitted.current = markdown;
        onChange(markdown);
      }, debounceMs);
    },
    [onChange, readOnly, debounceMs],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Serializing is the only thing that reaches the host, and it happens here
  // rather than inside a state updater so it stays a pure effect of the state.
  useEffect(() => {
    if (state.doc === serialized.current.doc && esm === serialized.current.esm) return;
    serialized.current = { doc: state.doc, esm };
    emit(state.doc, esm);
  }, [state.doc, esm, emit]);

  const dispatchTransaction = useCallback((tr: Transaction) => {
    setState((current) => current.apply(tr));
  }, []);

  // Adopt an external change without clobbering in-progress edits: only reparse
  // when the incoming markdown is not what we last wrote out.
  useEffect(() => {
    if (value === emitted.current) return;
    const next = mdastToDoc(schema, parseMdx(value));
    emitted.current = value;
    serialized.current = { doc: next.doc, esm: next.esm };
    setEsm(next.esm);
    setState(EditorState.create({ doc: next.doc, plugins }));
  }, [value]);

  /* ---------------------------------------------------------------- assets */

  // Global CSS/JS the components need, loaded once per document. Keyed on the
  // config so a changed list re-runs, while loadAssets itself de-duplicates.
  const assetsKey = useMemo(() => JSON.stringify([styles ?? [], scripts ?? []]), [styles, scripts]);
  useEffect(() => {
    void loadAssets(styles, scripts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetsKey]);

  /* ------------------------------------------------------------ components */

  const [components, setComponents] = useState<Map<string, ResolvedComponent>>(() => new Map());
  const [loading, setLoading] = useState(() => Object.keys(componentsOption ?? {}).length > 0);

  useEffect(() => {
    let live = true;
    if (!componentsOption || Object.keys(componentsOption).length === 0) {
      setComponents(new Map());
      setLoading(false);
      return;
    }
    setLoading(true);
    void loadComponents(componentsOption).then((loaded) => {
      if (!live) return;
      setComponents(loaded);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [componentsOption]);

  /* ------------------------------------------ imports the document declares */

  const imported = useMemo(() => importedNames(esm), [esm]);
  const undeclared = useMemo(() => {
    const used = new Set<string>();
    state.doc.descendants((node) => {
      const name = node.attrs?.name;
      if ((node.type.name === "mdx_jsx_flow" || node.type.name === "mdx_jsx_text") && /^[A-Z]/.test(name ?? "")) {
        used.add(name);
      }
    });
    return [...used].filter((name) => !imported.has(name)).sort();
  }, [state.doc, imported]);

  const [autoEditPos, setAutoEditPos] = useState<number | null>(null);
  const clearAutoEdit = useCallback(() => setAutoEditPos(null), []);

  const context = useMemo(
    () => ({ components, loading, readOnly, imported, autoEditPos, clearAutoEdit }),
    [components, loading, readOnly, imported, autoEditPos, clearAutoEdit],
  );

  /* ------------------------------------------------------------ focus mode */

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);

  // Focus mode takes over the whole viewport. It deliberately does not measure
  // a host container: covering only the detail pane leaves the editor pinned
  // beside the field list, which is the layout focus mode exists to escape.
  const toggleExpanded = useCallback(() => setExpanded((current) => !current), []);

  useEffect(() => {
    if (!expanded || typeof document === "undefined") return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setExpanded(false);
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [expanded]);

  /* ------------------------------------------------------------- rendering */

  // The design system is the source of truth for color; the stylesheet reads it
  // through these variables so no rule has a palette baked in.
  const vars = useMemo(
    () =>
      ({
        "--mdx-bg": theme.color.surfacePage,
        "--mdx-raised": theme.color.surfaceRaised,
        "--mdx-sunken": theme.color.surfaceSunken,
        "--mdx-hover": theme.color.surfaceHover,
        "--mdx-active": theme.color.surfaceActive,
        "--mdx-fg": theme.color.textPrimary,
        "--mdx-muted": theme.color.textSecondary,
        "--mdx-faint": theme.color.textTertiary,
        "--mdx-border": theme.color.borderDefault,
        "--mdx-border-subtle": theme.color.borderSubtle,
        "--mdx-accent": theme.color.borderActive,
        "--mdx-warn-fg": theme.color.diffDelFg,
        "--mdx-warn-bg": theme.color.diffDelBg,
        "--mdx-ok-fg": theme.color.diffAddFg,
        "--mdx-ok-bg": theme.color.diffAddBg,
        "--mdx-font": theme.font.sans,
        "--mdx-mono": theme.font.mono,
      }) as React.CSSProperties,
    [theme],
  );

  const editable = useCallback(() => !readOnly, [readOnly]);

  return (
    <div
      ref={wrapperRef}
      className={`cms-editor${expanded ? " cms-editor--expanded" : ""}`}
      data-theme={theme.mode}
      style={vars}
    >
      <MdxEditorContext.Provider value={context}>
        <ProseMirror
          state={state}
          dispatchTransaction={dispatchTransaction}
          editable={editable}
          nodeViewComponents={nodeViewComponents}
        >
          <Toolbar
            schema={schema}
            readOnly={readOnly}
            expanded={expanded}
            onToggleExpand={toggleExpanded}
            onInserted={setAutoEditPos}
          />
          <div className="cms-editor__scroll">
            <ProseMirrorDoc />
          </div>
        </ProseMirror>
        <EsmFooter entries={esm} onChange={setEsm} readOnly={readOnly} undeclared={undeclared} />
      </MdxEditorContext.Provider>
    </div>
  );
}
