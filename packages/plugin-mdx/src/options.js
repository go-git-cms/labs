// Plugin options arrive at `setup(cms, options)`, but a field component is
// registered as a bare loader and never sees them. Both hosts run setup exactly
// once per plugin, so a module-level store is the seam between the two.
//
// Options are JSON — both hosts serialize them into the generated
// `virtual:cms-plugins` module — so components are named by path here, not
// passed as references. See componentRegistry.ts for how those paths resolve.

let current = {};

export function setPluginOptions(options) {
  current = options && typeof options === "object" ? options : {};
}

export function getPluginOptions() {
  return current;
}
