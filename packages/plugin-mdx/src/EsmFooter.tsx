import React, { useEffect, useMemo, useRef, useState } from "react";

import { makeEntry, summarize, withValue, type EsmEntry } from "./esm";
import { ChevronIcon, PlusIcon, TrashIcon, WarningIcon } from "./icons";

/**
 * The document's imports and exports, as a footer.
 *
 * They are hidden from the visual render — an author writing prose never wants
 * a caret inside an import statement — but they still have to be visible and
 * editable, because a component is only usable once it is imported. This is
 * where they live.
 */
export function EsmFooter({
  entries,
  onChange,
  readOnly,
  undeclared,
}: {
  entries: EsmEntry[];
  onChange: (entries: EsmEntry[]) => void;
  readOnly: boolean;
  /** Capitalised JSX names used in the doc that nothing imports. */
  undeclared: string[];
}) {
  const [open, setOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const textareas = useRef(new Map<string, HTMLTextAreaElement>());

  const imports = useMemo(() => entries.filter((entry) => entry.kind === "import"), [entries]);
  const exports = useMemo(() => entries.filter((entry) => entry.kind === "export"), [entries]);

  useEffect(() => {
    if (!open || !focusId) return;
    const el = textareas.current.get(focusId);
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    setFocusId(null);
  }, [open, focusId, entries]);

  const edit = (id: string) => {
    setOpen(true);
    setFocusId(id);
  };

  const update = (id: string, value: string) =>
    onChange(entries.map((entry) => (entry.id === id ? withValue(entry, value) : entry)));

  const remove = (id: string) => onChange(entries.filter((entry) => entry.id !== id));

  const add = (seed: string) => {
    const entry = makeEntry(seed);
    onChange([...entries, entry]);
    edit(entry.id);
  };

  const summary =
    entries.length === 0
      ? "none"
      : [
          imports.length ? `${imports.length} import${imports.length === 1 ? "" : "s"}` : null,
          exports.length ? `${exports.length} export${exports.length === 1 ? "" : "s"}` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className={`cms-editor__footer${open ? " cms-editor__footer--open" : ""}`}>
      <div className="cms-editor__footer-bar">
        <button
          type="button"
          className="cms-editor__footer-toggle"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          title={open ? "Hide imports and exports" : "Show imports and exports"}
        >
          <ChevronIcon open={open} size={13} />
          <span className="cms-editor__footer-label">Imports &amp; exports</span>
          <span className="cms-editor__footer-count">{summary}</span>
        </button>

        {open ? null : (
          <div className="cms-editor__chips">
            {entries.map((entry) => (
              <EsmChip key={entry.id} entry={entry} onClick={() => edit(entry.id)} />
            ))}
          </div>
        )}

        {undeclared.length ? (
          <span
            className="cms-editor__footer-warn"
            title={`Used in this document but never imported: ${undeclared.join(", ")}`}
          >
            <WarningIcon size={12} />
            {undeclared.length} not imported
          </span>
        ) : null}

        {readOnly ? null : (
          <button
            type="button"
            className="cms-editor__tool cms-editor__footer-add"
            onClick={() => add("import  from ''")}
            title="Add an import or export"
            aria-label="Add an import or export"
          >
            <PlusIcon size={14} />
          </button>
        )}
      </div>

      {open ? (
        <div className="cms-editor__footer-body">
          {entries.length === 0 ? (
            <p className="cms-editor__footer-empty">
              This document imports nothing. A component has to be imported here before MDX can render it.
            </p>
          ) : null}

          {entries.map((entry) => (
            <div className="cms-editor__esm" key={entry.id}>
              <span className={`cms-editor__esm-kind cms-editor__esm-kind--${entry.kind}`}>{entry.kind}</span>
              <textarea
                className="cms-editor__esm-src"
                value={entry.value}
                readOnly={readOnly}
                spellCheck={false}
                autoComplete="off"
                rows={Math.min(6, entry.value.split("\n").length)}
                onChange={(e) => update(entry.id, e.target.value)}
                ref={(el) => {
                  if (el) textareas.current.set(entry.id, el);
                  else textareas.current.delete(entry.id);
                }}
              />
              {readOnly ? null : (
                <button
                  type="button"
                  className="cms-editor__esm-remove"
                  onClick={() => remove(entry.id)}
                  title="Remove this statement"
                  aria-label="Remove this statement"
                >
                  <TrashIcon size={13} />
                </button>
              )}
            </div>
          ))}

          {undeclared.length && !readOnly ? (
            <div className="cms-editor__footer-fix">
              <span className="cms-editor__footer-fixlabel">Not imported:</span>
              {undeclared.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="cms-editor__chip cms-editor__chip--warn"
                  onClick={() => add(`import ${name} from ''`)}
                  title={`Add an import for ${name}`}
                >
                  {name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EsmChip({ entry, onClick }: { entry: EsmEntry; onClick: () => void }) {
  const { names, from } = summarize(entry.value);
  const label = names.length ? names.join(", ") : entry.value.slice(0, 24);
  return (
    <button
      type="button"
      className={`cms-editor__chip cms-editor__chip--${entry.kind}`}
      onClick={onClick}
      title={entry.value}
    >
      <span className="cms-editor__chip-name">{label}</span>
      {from ? <span className="cms-editor__chip-from">{from}</span> : null}
    </button>
  );
}
