import React, { useEffect, useMemo, useRef, useState } from "react";

import { formatAttribute } from "./attributes";
import type { PropSpec, PropType } from "./componentRegistry";
import { CheckIcon, CloseIcon, PlusIcon, TrashIcon } from "./icons";
import type { JsxAttribute } from "./mdastToDoc";

/** How a row is being entered — the stored shape follows from this. */
type Mode = "text" | "expression" | "flag";

function modeOf(attr: JsxAttribute): Mode {
  if (attr.expression !== undefined) return "expression";
  return attr.value === true ? "flag" : "text";
}

function valueOf(attr: JsxAttribute): string {
  if (attr.expression !== undefined) return attr.expression;
  return attr.value === true ? "" : String(attr.value ?? "");
}

function toAttribute(name: string | null, mode: Mode, value: string): JsxAttribute {
  if (name === null) return { name: null, expression: value };
  if (mode === "expression") return { name, expression: value };
  if (mode === "flag") return { name, value: true };
  return { name, value };
}

/** A row keeps its own identity so re-ordering and deletion don't shuffle focus. */
type Row = { key: string; name: string | null; mode: Mode; value: string };

let rowCounter = 0;
const rowKey = () => `row-${++rowCounter}`;

function toRows(attributes: JsxAttribute[]): Row[] {
  return attributes.map((attr) => ({
    key: rowKey(),
    name: attr.name,
    mode: modeOf(attr),
    value: valueOf(attr),
  }));
}

/** A declared prop's type maps onto the row modes. */
function modeForSpec(type: PropType | undefined): Mode {
  if (type === "boolean") return "flag";
  if (type === "number" || type === "expression") return "expression";
  return "text";
}

export function PropsForm({
  name,
  attributes,
  specs,
  onCommit,
  onCancel,
}: {
  name: string;
  attributes: JsxAttribute[];
  specs: PropSpec[];
  onCommit: (attributes: JsxAttribute[]) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(attributes));
  const firstInput = useRef<HTMLInputElement | null>(null);

  // Opening the form is a deliberate act — put the caret where the work is.
  useEffect(() => {
    firstInput.current?.focus();
  }, []);

  const specByName = useMemo(() => new Map(specs.map((spec) => [spec.name, spec])), [specs]);
  const unusedSpecs = useMemo(
    () => specs.filter((spec) => !rows.some((row) => row.name === spec.name)),
    [specs, rows],
  );

  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const remove = (key: string) => setRows((current) => current.filter((row) => row.key !== key));

  const add = (spec?: PropSpec) =>
    setRows((current) => [
      ...current,
      {
        key: rowKey(),
        name: spec?.name ?? "",
        mode: modeForSpec(spec?.type),
        value: "",
      },
    ]);

  const commit = () => {
    const next = rows
      .filter((row) => {
        // An expression row with nothing in it would serialize to `prop={}`,
        // which is not valid MDX. Treat it as a prop that was never set.
        if (row.mode === "expression" || row.name === null) return row.value.trim() !== "";
        return row.name.trim() !== "";
      })
      .map((row) => toAttribute(row.name === null ? null : row.name.trim(), row.mode, row.value));
    onCommit(next);
  };

  // The form lives inside the editor's DOM; keep its keys to itself.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commit();
    }
  };

  return (
    <div className="mdx-form" contentEditable={false} onKeyDown={onKeyDown}>
      <div className="mdx-form__head">
        <span className="mdx-form__title">
          {"<"}
          {name || "Fragment"}
          {">"}
        </span>
        <span className="mdx-form__spacer" />
        <button type="button" className="mdx-form__btn" onClick={onCancel} title="Discard (Esc)">
          <CloseIcon size={14} />
          Cancel
        </button>
        <button
          type="button"
          className="mdx-form__btn mdx-form__btn--primary"
          onClick={commit}
          title="Apply (⌘⏎)"
        >
          <CheckIcon size={14} />
          Done
        </button>
      </div>

      {rows.length === 0 ? <p className="mdx-form__empty">No props set.</p> : null}

      <div className="mdx-form__rows">
        {rows.map((row, index) => {
          const spec = row.name === null ? undefined : specByName.get(row.name);
          const spread = row.name === null;
          return (
            <div className="mdx-form__row" key={row.key}>
              {spread ? (
                <span className="mdx-form__spread" title="Spread attribute">
                  {"{…}"}
                </span>
              ) : (
                <input
                  ref={index === 0 ? (el) => void (firstInput.current = el) : undefined}
                  className="mdx-form__name"
                  value={row.name ?? ""}
                  placeholder="prop"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => update(row.key, { name: e.target.value })}
                />
              )}

              {spread ? null : (
                <select
                  className="mdx-form__mode"
                  value={row.mode}
                  onChange={(e) => update(row.key, { mode: e.target.value as Mode })}
                  title="How this prop is written"
                >
                  <option value="text">"text"</option>
                  <option value="expression">{"{expr}"}</option>
                  <option value="flag">flag</option>
                </select>
              )}

              {row.mode === "flag" && !spread ? (
                <span className="mdx-form__flag">present</span>
              ) : spec?.options?.length && row.mode === "text" ? (
                <select
                  className="mdx-form__value"
                  value={row.value}
                  onChange={(e) => update(row.key, { value: e.target.value })}
                >
                  <option value="">—</option>
                  {spec.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={`mdx-form__value${row.mode === "expression" || spread ? " mdx-form__value--mono" : ""}`}
                  value={row.value}
                  placeholder={row.mode === "expression" || spread ? "expression" : "value"}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => update(row.key, { value: e.target.value })}
                />
              )}

              <button
                type="button"
                className="mdx-form__icon"
                onClick={() => remove(row.key)}
                title={`Remove ${spread ? "spread" : row.name || "prop"}`}
                aria-label={`Remove ${spread ? "spread" : row.name || "prop"}`}
              >
                <TrashIcon size={13} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="mdx-form__foot">
        <button type="button" className="mdx-form__btn" onClick={() => add()}>
          <PlusIcon size={13} />
          Add prop
        </button>
        {unusedSpecs.length ? (
          <div className="mdx-form__suggest">
            {unusedSpecs.map((spec) => (
              <button
                key={spec.name}
                type="button"
                className={`mdx-form__chip${spec.required ? " mdx-form__chip--required" : ""}`}
                onClick={() => add(spec)}
                title={spec.required ? `${spec.name} (required)` : spec.name}
              >
                {spec.label ?? spec.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <p className="mdx-form__preview">
        {"<"}
        {name}
        {rows.map((row) => (
          <span key={row.key}>
            {" "}
            {formatAttribute(toAttribute(row.name === null ? null : row.name, row.mode, row.value))}
          </span>
        ))}
        {" />"}
      </p>
    </div>
  );
}
