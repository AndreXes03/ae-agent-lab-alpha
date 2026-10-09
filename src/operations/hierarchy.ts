import { jsxCompPreamble, jsxFail, jsxVal, registerOp } from "../registry.js";

registerOp({
  name: "comp.inspect_hierarchy",
  category: "comp",
  readOnly: true,
  description:
    "Bounded read of selected layer parents, direct children, matte links and transform/expression flags. Does not prove a controller safe to delete: expression references and other comps are not scanned.",
  params: [
    { name: "comp", type: "any", required: true, description: "Comp name or numeric ID" },
    {
      name: "layer",
      type: "any",
      description: "Index, name, {id}, array, or selected (default selected)",
    },
    { name: "maxLayers", type: "number", description: "Selected layer limit, 1–100 (default 20)" },
    {
      name: "maxAncestors",
      type: "number",
      description: "Parent limit per layer, 1–100 (default 20)",
    },
    {
      name: "maxProperties",
      type: "number",
      description: "Property visits per layer, 1–1000 (default 100)",
    },
    {
      name: "maxRelationLayers",
      type: "number",
      description: "Comp layers scanned for children/matte consumers, 1–1000 (default 200)",
    },
  ],
  toJsx(args) {
    const bounds = { maxLayers: 20, maxAncestors: 20, maxProperties: 100, maxRelationLayers: 200 };
    for (const key of Object.keys(bounds) as (keyof typeof bounds)[]) {
      const value = args[key] ?? bounds[key];
      const cap = key === "maxProperties" || key === "maxRelationLayers" ? 1000 : 100;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > cap) {
        return jsxFail(`${key} must be an integer between 1 and ${cap}`);
      }
      bounds[key] = value;
    }
    return `
      ${jsxCompPreamble(args)}
      var limits = ${jsxVal(bounds)};
      var spec = ${jsxVal(args.layer ?? "selected")};
      function ref(layer) { return layer ? {id: typeof layer.id === "number" ? layer.id : null, index: layer.index, name: layer.name} : null; }
      function matte(layer) {
        try {
          if (typeof layer.trackMatteLayer !== "undefined") return {status: "known", layer: ref(layer.trackMatteLayer), type: String(layer.trackMatteType)};
          if (layer.hasTrackMatte && layer.index > 1) return {status: "legacy_adjacent", layer: ref(_comp.layer(layer.index - 1)), type: String(layer.trackMatteType)};
          if (typeof layer.hasTrackMatte === "boolean") return {status: "known", layer: null};
        } catch (e) {}
        return {status: "unavailable", layer: null};
      }
      var requested = spec === "selected" ? _comp.selectedLayers : (spec instanceof Array ? spec : [spec]);
      var rows = [], seen = {}, missing = [], selectionTruncated = requested.length > limits.maxLayers;
      var relationCount = Math.min(_comp.numLayers, limits.maxRelationLayers);
      for (var i = 0; i < Math.min(requested.length, limits.maxLayers); i++) {
        var layer = spec === "selected" ? requested[i] : AE.findLayerInComp(_comp, requested[i]);
        if (!layer) { missing.push(requested[i]); continue; }
        if (seen[layer.index]) continue;
        seen[layer.index] = true;
        var row = {layer: ref(layer), parent: ref(layer.parent), ancestors: [], parentCycle: false, ancestorsTruncated: false, directChildren: [], matte: matte(layer), matteConsumers: [], transforms: [], transformsTruncated: false, expressions: [], propertyVisits: 0, propertiesTruncated: false};
        var parentSeen = {}; parentSeen[layer.index] = true;
        var parent = layer.parent;
        while (parent) {
          if (parentSeen[parent.index]) { row.parentCycle = true; break; }
          if (row.ancestors.length >= limits.maxAncestors) { row.ancestorsTruncated = true; break; }
          parentSeen[parent.index] = true; row.ancestors.push(ref(parent)); parent = parent.parent;
        }
        for (var j = 1; j <= relationCount; j++) {
          var candidate = _comp.layer(j);
          if (candidate.parent === layer) row.directChildren.push(ref(candidate));
          var link = matte(candidate);
          if (link.layer && link.layer.index === layer.index) row.matteConsumers.push(ref(candidate));
        }
        var transform = layer.property("ADBE Transform Group");
        row.transformsTruncated = !!transform && transform.numProperties > 32;
        if (transform) for (var t = 1; t <= Math.min(transform.numProperties, 32); t++) {
          var tp = transform.property(t);
          row.transforms.push({name: tp.name, matchName: tp.matchName, animated: tp.numKeys > 0, expressionEnabled: !!tp.expressionEnabled});
        }
        var stack = [{group: layer, next: 1, path: []}];
        while (stack.length) {
          var frame = stack[stack.length - 1];
          if (frame.next > frame.group.numProperties) { stack.pop(); continue; }
          if (row.propertyVisits >= limits.maxProperties) { row.propertiesTruncated = true; break; }
          var index = frame.next++, prop = frame.group.property(index);
          row.propertyVisits++;
          var propPath = frame.path.concat([index]);
          if (prop.canSetExpression && prop.expression) row.expressions.push({path: propPath, name: prop.name, matchName: prop.matchName, enabled: !!prop.expressionEnabled, animated: prop.numKeys > 0});
          if (prop.numProperties > 0) stack.push({group: prop, next: 1, path: propPath});
        }
        row.childrenAndMatteScanComplete = relationCount === _comp.numLayers;
        row.externalDependencies = {status: "unknown", reason: "Expression references, other comps and project-wide dependencies are not resolved; this result cannot establish safe deletion."};
        rows.push(row);
      }
      return {ok: true, comp: {id: _comp.id, name: _comp.name}, layers: rows, missing: missing, limits: limits, selectionTruncated: selectionTruncated, relationLayersScanned: relationCount, relationScanComplete: relationCount === _comp.numLayers, expressionReferencesComplete: false};
    `;
  },
});
