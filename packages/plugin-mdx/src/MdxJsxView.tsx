import {
  useEditorEventCallback,
  useIgnoreMutation,
  useMergedDOMRefs,
  useStopEvent,
  type NodeViewComponentProps,
} from "@handlewithcare/react-prosemirror";
import React, { useEffect, useRef, useState } from "react";

import { attributesToProps, formatAttribute, toReactProps } from "./attributes";
import { useMdxEditor } from "./context";
import { PencilIcon, WarningIcon } from "./icons";
import type { JsxAttribute } from "./mdastToDoc";
import { PropsForm } from "./PropsForm";

const cx = (...names: (string | undefined | false)[]) => names.filter(Boolean).join(" ");

/* --------------------------------------------------------- error boundary */

/**
 * A configured component is the author's own code running inside the CMS. If
 * it throws, the node falls back to the card representation instead of taking
 * the editor down with it.
 */
class PreviewBoundary extends React.Component<
  { children: React.ReactNode; onError: (message: string) => void; resetKey: string },
  { failed: boolean; key: string }
> {
  state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  // A throw is almost always about the props, so editing them has to give the
  // component another chance. Without this the first bad render is permanent
  // and fixing the prop that caused it changes nothing.
  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { failed: boolean; key: string },
  ) {
    return props.resetKey === state.key ? null : { failed: false, key: props.resetKey };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error.message);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/* ------------------------------------------------------------ flow element */

/**
 * `<Callout>…</Callout>` in a block position.
 *
 * A configured component renders live, with the node's editable children handed
 * to it as `children` — so the component's own chrome surrounds real, editable
 * prose. Anything unconfigured renders as a card carrying the same affordances.
 * Either way the top-right pencil swaps the whole thing for the props form.
 */
export function MdxJsxFlowView({ children, nodeProps, ref, ...props }: NodeViewComponentProps) {
  const { node, contentDOMRef, getPos } = nodeProps;
  const { name, attributes } = node.attrs as { name: string; attributes: JsxAttribute[] };
  const { components, loading, readOnly, imported, autoEditPos, clearAutoEdit } = useMdxEditor();

  const [editing, setEditing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLElement | null>(null);

  const mergedRoot = useMergedDOMRefs(ref as React.Ref<any>, rootRef);
  const mergedBody = useMergedDOMRefs(contentDOMRef, bodyRef);

  // The toolbar's insert lands the caret in the new node's form.
  useEffect(() => {
    if (autoEditPos !== null && autoEditPos === getPos()) {
      setEditing(true);
      clearAutoEdit();
    }
  }, [autoEditPos, getPos, clearAutoEdit]);

  // A live preview and a props form are React-owned DOM inside the editor.
  // ProseMirror must neither read their mutations nor handle their events —
  // except inside the body, which is genuinely its content.
  const inBody = (target: EventTarget | Node | null) =>
    !!bodyRef.current && target instanceof Node && bodyRef.current.contains(target);

  useIgnoreMutation((_view, mutation) => !inBody(mutation.target));
  useStopEvent((_view, event) => !inBody(event.target));

  const setAttributes = useEditorEventCallback((view, next: JsxAttribute[]) => {
    const tr = view.state.tr.setNodeMarkup(getPos(), undefined, { ...node.attrs, attributes: next });
    view.dispatch(tr);
  });

  const resolved = components.get(name);
  const { props: literalProps, unresolved } = attributesToProps(attributes);
  // Identity of the current props, for resetting a failed render.
  const attrKey = JSON.stringify(attributes);

  // Let a component that threw try again once its props change.
  useEffect(() => setFailure(null), [attrKey]);
  // `<>…</>` parses with no name; `<Fragment slot="x">` is Astro's named-slot
  // spelling of the same idea. Both are intrinsic — neither is ever imported.
  const isFragment = !name || name === "Fragment";
  const missingImport = !isFragment && /^[A-Z]/.test(name) && !imported.has(name);

  const editButton = readOnly ? null : (
    <button
      type="button"
      className="mdx-jsx__edit"
      onClick={() => setEditing(true)}
      title={`Edit ${name || "element"} props`}
      aria-label={`Edit ${name || "element"} props`}
    >
      <PencilIcon size={13} />
    </button>
  );

  const warnings = (
    <>
      {unresolved.length ? (
        <span
          className="mdx-jsx__hint"
          title={`Could not resolve: ${unresolved.join(", ")} — these reference the document's own imports, which do not exist in the editor`}
        >
          <WarningIcon size={12} />
          {unresolved.length}
        </span>
      ) : null}
      {missingImport ? (
        <span className="mdx-jsx__hint" title={`${name} is not imported by this document`}>
          <WarningIcon size={12} />
          not imported
        </span>
      ) : null}
    </>
  );

  const chrome = (
    <div className="mdx-jsx__chrome" contentEditable={false}>
      <span className="mdx-jsx__name">{name || "Fragment"}</span>
      {warnings}
      <span className="mdx-jsx__spacer" />
      {editButton}
    </div>
  );

  const body = (
    <div className="mdx-jsx__body" ref={mergedBody as React.Ref<HTMLDivElement>}>
      {children}
    </div>
  );

  // The same content, for when it sits inside the component's own markup: that
  // subtree is contentEditable={false}, so the editable island has to opt back in.
  const liveBody = (
    <div
      className="mdx-jsx__body"
      contentEditable
      suppressContentEditableWarning
      ref={mergedBody as React.Ref<HTMLDivElement>}
    >
      {children}
    </div>
  );

  if (editing) {
    return (
      <div {...props} ref={mergedRoot as React.Ref<HTMLDivElement>} className={cx(props.className, "mdx-jsx", "mdx-jsx--editing")}>
        <PropsForm
          name={name}
          attributes={attributes}
          specs={resolved?.props ?? []}
          onCommit={(next) => {
            setAttributes(next);
            setFailure(null);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
        <div className="mdx-jsx__children-label" contentEditable={false}>
          children
        </div>
        {body}
      </div>
    );
  }

  // A fragment renders nothing of its own — it is a grouping marker, and in
  // Astro's case a slot label. Drawing a card around one would give the most
  // invisible element in the document the loudest treatment, so it passes its
  // children straight through and keeps only a hover-revealed handle.
  if (isFragment) {
    return (
      <div
        {...props}
        ref={mergedRoot as React.Ref<HTMLDivElement>}
        className={cx(props.className, "mdx-jsx", "mdx-jsx--fragment")}
      >
        {body}
        <div className="mdx-jsx__controls" contentEditable={false}>
          <span className="mdx-jsx__fragment-label">
            {attributes.length ? attributes.map(formatAttribute).join(" ") : "<>"}
          </span>
          {editButton}
        </div>
      </div>
    );
  }

  if (resolved && !failure) {
    const Component = resolved.Component;
    // The component *is* the render — no card, no header, nothing of the
    // editor's between it and the page. The only addition is a control that
    // floats over its top-right corner on hover.
    //
    // Children go to the component as `children` so its own markup wraps real
    // editable prose. When the element has none, the contentDOM still has to
    // exist for ProseMirror, so it is parked (hidden) after the component
    // rather than handed to it.
    const hasChildren = node.content.size > 0;
    return (
      <div
        {...props}
        ref={mergedRoot as React.Ref<HTMLDivElement>}
        className={cx(props.className, "mdx-jsx", "mdx-jsx--live")}
        // The component renders for real, links and all. Following one would
        // navigate away from the editor, so swallow that and nothing else.
        onClickCapture={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest?.("a[href], button[type='submit']")) event.preventDefault();
        }}
      >
        <div className="mdx-jsx__render" contentEditable={false}>
          <PreviewBoundary onError={setFailure} resetKey={attrKey}>
            <Component {...toReactProps(literalProps)}>{hasChildren ? liveBody : null}</Component>
          </PreviewBoundary>
        </div>
        {hasChildren ? null : <div className="mdx-jsx__parked">{body}</div>}
        <div className="mdx-jsx__controls" contentEditable={false}>
          {warnings}
          {editButton}
        </div>
      </div>
    );
  }

  return (
    <div
      {...props}
      ref={mergedRoot as React.Ref<HTMLDivElement>}
      className={cx(props.className, "mdx-jsx", "mdx-jsx--card")}
    >
      {chrome}
      <div className="mdx-jsx__attrs" contentEditable={false}>
        {attributes.length ? (
          attributes.map((attr, i) => (
            <code className="mdx-jsx__attr" key={attr.name ?? `spread-${i}`}>
              {formatAttribute(attr)}
            </code>
          ))
        ) : (
          <span className="mdx-jsx__attr mdx-jsx__attr--empty">no props</span>
        )}
      </div>
      {failure ? (
        <p className="mdx-jsx__error" contentEditable={false}>
          {name} threw while rendering: {failure}
        </p>
      ) : loading ? (
        <p className="mdx-jsx__loading" contentEditable={false}>
          loading components…
        </p>
      ) : null}
      {body}
    </div>
  );
}

/* ------------------------------------------------------------ text element */

/** The same element mid-sentence: a name badge, then its editable children. */
export function MdxJsxTextView({ children, nodeProps, ref, ...props }: NodeViewComponentProps) {
  const { node, contentDOMRef, getPos } = nodeProps;
  const { name, attributes } = node.attrs as { name: string; attributes: JsxAttribute[] };
  const { readOnly } = useMdxEditor();

  const [editing, setEditing] = useState(false);
  const bodyRef = useRef<HTMLElement | null>(null);
  const mergedBody = useMergedDOMRefs(contentDOMRef, bodyRef);

  const inBody = (target: EventTarget | Node | null) =>
    !!bodyRef.current && target instanceof Node && bodyRef.current.contains(target);

  useIgnoreMutation((_view, mutation) => !inBody(mutation.target));
  useStopEvent((_view, event) => !inBody(event.target));

  const setAttributes = useEditorEventCallback((view, next: JsxAttribute[]) => {
    view.dispatch(view.state.tr.setNodeMarkup(getPos(), undefined, { ...node.attrs, attributes: next }));
  });

  const title = attributes.length
    ? `<${name} ${attributes.map(formatAttribute).join(" ")}>`
    : `<${name}>`;

  return (
    <span {...props} ref={ref} className={cx(props.className, "mdx-jsx-text")}>
      <button
        type="button"
        className="mdx-jsx-text__tag"
        contentEditable={false}
        title={readOnly ? title : `${title} — click to edit props`}
        onClick={() => !readOnly && setEditing((open) => !open)}
      >
        {name}
      </button>
      <span className="mdx-jsx-text__body" ref={mergedBody as React.Ref<HTMLSpanElement>}>
        {children}
      </span>
      {editing ? (
        <span className="mdx-jsx-text__pop" contentEditable={false}>
          <PropsForm
            name={name}
            attributes={attributes}
            specs={[]}
            onCommit={(next) => {
              setAttributes(next);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </span>
      ) : null}
    </span>
  );
}

/* -------------------------------------------------------------- raw / expr */

/** A block expression or a raw HTML block — source is all there is to show. */
export function MdxRawView({ nodeProps, ref, ...props }: NodeViewComponentProps) {
  const { kind, value } = nodeProps.node.attrs;
  return (
    <pre {...props} ref={ref} className={cx(props.className, "mdx-raw")} contentEditable={false} data-kind={kind}>
      {value}
    </pre>
  );
}

/** `{frontmatter.title}` mid-sentence. */
export function MdxExpressionView({ nodeProps, ref, ...props }: NodeViewComponentProps) {
  const { value } = nodeProps.node.attrs;
  return (
    <code {...props} ref={ref} className={cx(props.className, "mdx-expression")} contentEditable={false}>
      {`{${value}}`}
    </code>
  );
}
