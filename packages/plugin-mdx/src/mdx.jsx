import React, { useCallback } from "react";

import { MdxEditor } from "./MdxEditor";
import { getPluginOptions } from "./options.js";

/**
 * The `plugin:mdx` field component. A plugin field receives the field's data as
 * one object (PluginFieldProps): the schema field plus value/onChange/readOnly.
 *
 * Everything about how the document is rendered lives in MdxEditor; this is the
 * seam that hands it the field's value and the plugin's options.
 */
export default function MDXField({ value, onChange, readOnly }) {
  const { components, styles, scripts } = getPluginOptions();

  // The editor emits markdown; the field stores it verbatim.
  const handleChange = useCallback(
    (markdown) => {
      if (onChange) onChange(markdown);
    },
    [onChange],
  );

  return (
    <MdxEditor
      value={typeof value === "string" ? value : ""}
      onChange={handleChange}
      readOnly={!!readOnly}
      components={components}
      styles={styles}
      scripts={scripts}
    />
  );
}
