/** Runtime-relative edits: current values stay in AE instead of crossing the model boundary. */
import { registerOp, jsxVal, jsxCompLayerPreamble, jsxPropertyLookup } from "../registry.js";

registerOp({
  name: "property.adjust",
  category: "property",
  description:
    "Read, calculate and adjust one numeric property inside AE. mode=offset supports static values or all existing keys (preserves their timing/easing). mode=multiply supports static values only. Refuses expressions and separated dimensions. Bounded to 2000 keys; preflights all values and verifies readback. Prefer ae_edit for checkpoint and retry protection.",
  params: [
    { name: "comp", type: "any", description: "Numeric composition item id", required: true },
    { name: "layer", type: "any", description: "Fixed layer index", required: true },
    { name: "property", type: "array", description: "Explicit property path", required: true },
    { name: "mode", type: "string", description: "offset or multiply", required: true },
    {
      name: "amount",
      type: "any",
      description: "Finite scalar or matching numeric vector",
      required: true,
    },
    { name: "scope", type: "string", description: "static (default) or keys", default: "static" },
  ],
  toJsx(args) {
    return `
${jsxCompLayerPreamble(args)}
var _propPath = ${jsxVal(args.property)};
${jsxPropertyLookup()}
var _mode = ${jsxVal(args.mode)}, _amount = ${jsxVal(args.amount)}, _scope = ${jsxVal(args.scope ?? "static")};
if (_mode !== "offset" && _mode !== "multiply") return {ok:false,error:"mode must be offset or multiply"};
if (_scope !== "static" && _scope !== "keys") return {ok:false,error:"scope must be static or keys"};
if (_node.expression || _node.expressionEnabled) return {ok:false,error:"Expression-driven properties are not supported"};
if (_node.isSeparationLeader && _node.dimensionsSeparated) return {ok:false,error:"Address a separated dimension explicitly"};
if (_scope === "static" && _node.numKeys) return {ok:false,error:"Animated property requires scope=keys"};
if (_scope === "keys" && (_mode !== "offset" || !_node.numKeys || _node.numKeys > 2000)) return {ok:false,error:"keys scope requires offset and 1..2000 existing keys"};
function _finite(v) { return typeof v === "number" && isFinite(v); }
function _adjustValue(v) {
  var vector = v instanceof Array, count = vector ? v.length : 1;
  if (vector && (count < 1 || count > 4)) throw new Error("Only numeric scalar and 1..4 dimensional vectors supported");
  if (_amount instanceof Array && _amount.length !== count) throw new Error("amount dimension differs from property");
  var result = [];
  for (var j=0;j<count;j++) {
    var old = vector ? v[j] : v;
    var a = _amount instanceof Array ? _amount[j] : _amount;
    if (!_finite(old) || !_finite(a)) throw new Error("Property and amount must be finite numbers");
    var next = _mode === "offset" ? old+a : old*a;
    if (!_finite(next)) throw new Error("Adjustment overflow");
    if (_node.hasMin && next < _node.minValue || _node.hasMax && next > _node.maxValue) throw new Error("Adjustment exceeds property range");
    result.push(next);
  }
  return vector ? result : result[0];
}
function _near(a,b) {
  if (a instanceof Array && b instanceof Array) {
    if(a.length !== b.length) return false;
    for(var j=0;j<a.length;j++) if(!_near(a[j],b[j])) return false;
    return true;
  }
  return _finite(a) && _finite(b) && Math.abs(a-b) <= 0.000001 * Math.max(1,Math.abs(b));
}
var _planned=[];
try {
  if (_scope === "keys") for(var k=1;k<=_node.numKeys;k++) _planned.push(_adjustValue(_node.keyValue(k)));
  else _planned.push(_adjustValue(_node.value));
} catch(e) { return {ok:false,error:String(e.message || e)}; }
for(var k=0;k<_planned.length;k++) {
  if(_scope === "keys") _node.setValueAtKey(k+1,_planned[k]); else _node.setValue(_planned[k]);
}
for(var k=0;k<_planned.length;k++) {
  var _actual = _scope === "keys" ? _node.keyValue(k+1) : _node.value;
  if(!_near(_actual,_planned[k])) return {ok:false,error:"Adjustment readback differs; inspect checkpoint before retry"};
}
return {ok:true,adjustedValues:_planned.length,scope:_scope,mode:_mode,verified:true};
`;
  },
});
