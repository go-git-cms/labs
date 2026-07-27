// Plugin entrypoint (docs/plugin-system.md). Default-exports the setup
// function; the field component is a loader so it becomes its own lazy chunk
// under the SPA build and its own import in the desktop runtime.
//
//   plugins: [
//     ["./plugins/plugin-mdx", {
//       components: {
//         Canvas: "./src/lib/@ui/Canvas.tsx",
//         Disclaimer: "./src/lib/@ui/Disclaimer.tsx",
//       },
//     }],
//   ]
//
// See README.md for the full options shape.

import { setPluginOptions } from "./options.js";

export default function setup(cms, options) {
  // A field component is registered as a bare loader and never sees `options`,
  // so stash them where the component can reach them.
  setPluginOptions(options);

  cms.registerFieldComponent({
    name: "mdx",
    types: ["string"],
    component: () => import("./mdx.jsx"),
  });
}
