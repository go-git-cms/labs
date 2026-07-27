import { createContext, useContext } from "react";

import type { ResolvedComponent } from "./componentRegistry";

export type MdxEditorContextValue = {
  /** Configured components that resolved, by JSX tag name. */
  components: Map<string, ResolvedComponent>;
  /** True until the configured components have finished loading. */
  loading: boolean;
  readOnly: boolean;
  /** Names the document's imports bring into scope, for the "not imported" hint. */
  imported: Set<string>;
  /**
   * Position of a node that should open its edit form on mount — set when the
   * toolbar inserts a component, so the author lands straight in the form.
   */
  autoEditPos: number | null;
  clearAutoEdit: () => void;
};

const fallback: MdxEditorContextValue = {
  components: new Map(),
  loading: false,
  readOnly: false,
  imported: new Set(),
  autoEditPos: null,
  clearAutoEdit: () => {},
};

export const MdxEditorContext = createContext<MdxEditorContextValue>(fallback);

export function useMdxEditor(): MdxEditorContextValue {
  return useContext(MdxEditorContext);
}
