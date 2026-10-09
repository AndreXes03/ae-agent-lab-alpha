# Bounded hierarchy inspection

Call `ae_do` with `comp.inspect_hierarchy` before changing a controller or parenting:

```json
{"operation":"comp.inspect_hierarchy","args":{"comp":42,"layer":[{"id":101},3],"maxLayers":20,"maxAncestors":20,"maxProperties":100,"maxRelationLayers":200}}
```

The default layer selector is `selected`. Numeric layers are 1-based indexes; `{ "id": 101 }` uses a stable layer ID. Results include comp/layer IDs, parents and bounded ancestor chains, direct children, track matte sources and consumers, transform animation/expression flags, and expression property paths without expression text or values. Missing selections and each truncated scan are explicit. Older AE versions can return null layer IDs; use the index only within the inspected state.

Relation inspection visits at most `maxRelationLayers` layers of the chosen comp. Property inspection visits at most `maxProperties` nodes per selected layer, including groups. Ancestor cycles stop immediately. Limits are positive integers; caps are 100 layers/ancestors and 1000 relation layers/property visits. Reorder operations can change indexes.

`externalDependencies.status` is always `unknown`: expressions can refer to a controller dynamically, and other comps are outside this scope. Even complete children/matte scans do not prove deletion safe. The operation never reparents, compensates transforms, changes the project, evaluates expressions, or scans all project compositions. Modern matte links are preferred; older adjacency links are labeled `legacy_adjacent` and unavailable access is labeled `unavailable`.

Tests execute generated JSX against mocks. Native AE acceptance remains separate.
