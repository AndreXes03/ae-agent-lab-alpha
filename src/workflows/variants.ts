/** Bounded, typed text/logo variant recipe. This module does not talk to AE. */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const fieldKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/);
const field = z
  .object({
    key: fieldKey,
    kind: z.enum(["text", "logo"]),
    layerPath: z.array(z.number().int().positive()).min(1).max(12),
  })
  .strict();
const variant = z
  .object({
    name: z.string().trim().min(1).max(60),
    values: z.record(fieldKey, z.string().max(500)),
  })
  .strict();
export const variantsSpec = z
  .object({
    compId: z.number().int().positive(),
    fields: z.array(field).min(1).max(16),
    variants: z.array(variant).min(1).max(8),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const keys = new Set<string>();
    const paths = new Set<string>();
    for (const [i, f] of spec.fields.entries()) {
      if (keys.has(f.key))
        ctx.addIssue({
          code: "custom",
          path: ["fields", i, "key"],
          message: "Duplicate field key",
        });
      if (paths.has(JSON.stringify(f.layerPath)))
        ctx.addIssue({
          code: "custom",
          path: ["fields", i, "layerPath"],
          message: "Ambiguous field: layer target repeats",
        });
      keys.add(f.key);
      paths.add(JSON.stringify(f.layerPath));
    }
    const names = new Set<string>();
    for (const [i, v] of spec.variants.entries()) {
      if (names.has(v.name))
        ctx.addIssue({
          code: "custom",
          path: ["variants", i, "name"],
          message: "Duplicate variant name",
        });
      names.add(v.name);
      for (const key of keys)
        if (!Object.prototype.hasOwnProperty.call(v.values, key))
          ctx.addIssue({
            code: "custom",
            path: ["variants", i, "values", key],
            message: "Missing field value",
          });
      for (const key of Object.keys(v.values))
        if (!keys.has(key))
          ctx.addIssue({
            code: "custom",
            path: ["variants", i, "values", key],
            message: "Unknown field value",
          });
    }
  });
export type VariantsSpec = z.infer<typeof variantsSpec>;

function jsxLiteral(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export interface VariantsSnapshot {
  projectPath: string;
  compId: number;
  hierarchy: Array<{
    id: number;
    name: string;
    layers: Array<{
      index: number;
      name: string;
      kind: string;
      sourceId: number | null;
      sourcePath: string | null;
      properties: unknown;
    }>;
  }>;
  fields: Array<{
    key: string;
    kind: "text" | "logo";
    layerPath: number[];
    compId: number;
    layerIndex: number;
    layerName: string;
    sourceId: number | null;
    sourceTextKeys: number;
    textStyleFingerprint: string | null;
    hasEnabledExpression: boolean;
  }>;
  findings: string[];
}

function rejectExpressions(property: unknown): void {
  if (!property || typeof property !== "object") return;
  const p = property as { expressionEnabled?: boolean; children?: unknown[] };
  if (p.expressionEnabled) throw new Error("Enabled expression in source hierarchy");
  if (Array.isArray(p.children)) p.children.forEach(rejectExpressions);
}

/** Body for the existing AE JSX dispatcher. Returns a JSON-safe plain object. */
export function captureVariants(input: VariantsSpec): string {
  const spec = variantsSpec.parse(input);
  return `
var spec = ${jsxLiteral(spec)};
var findings = [], hierarchy = [], fields = [], seen = {}, visiting = {}, propCount = 0, keyCount = 0, layerCount = 0;
function fail(s) { findings.push(s); }
function byId(id) { for (var i = 1; i <= app.project.numItems; i++) { var x = app.project.item(i); if (x.id === id) return x; } return null; }
function textStyle(doc, key) {
  if (typeof doc.characterRange !== "function") { fail("Character style inspection requires AE 24.3 or later for " + key); return null; }
  var s=String(doc.text), last=null, signatures=[];
  if (s.length>500) { fail("Source text exceeds 500 characters for " + key); return null; }
  if ((s.indexOf("\\r")>=0 && s.indexOf("\\r")<s.length-1) || (s.indexOf("\\n")>=0 && s.indexOf("\\n")<s.length-1)) { fail("Multiline source text is unsupported for " + key); return null; }
  for(var i=0;i<s.length;i++) {
    if (i===s.length-1 && s.charAt(i)==="\\r") break;
    try {
      var r=doc.characterRange(i,i+1);
      var v={font:r.font,fontSize:r.fontSize,fillColor:r.fillColor,strokeColor:r.strokeColor,strokeWidth:r.strokeWidth,applyFill:r.applyFill,applyStroke:r.applyStroke,tracking:r.tracking,leading:r.leading,baselineShift:r.baselineShift,fauxBold:r.fauxBold,fauxItalic:r.fauxItalic,horizontalScale:r.horizontalScale,verticalScale:r.verticalScale};
      var sig=JSON.stringify(v);
      if (last!==null && sig!==last) fail("Mixed character styling is unsupported for " + key);
      last=sig;signatures.push(sig);
    } catch(e) { fail("Cannot inspect character style for " + key); return null; }
  }
  return JSON.stringify(signatures);
}
function plain(v) {
  if (v === null || v === undefined) return null;
  var t = typeof v;
  if (t === "string" || t === "boolean" || t === "number") return v;
  if (v instanceof Array) { var a=[]; for (var i=0;i<v.length;i++) a.push(plain(v[i])); return a; }
  if (v.text !== undefined && v.font !== undefined) return { text:String(v.text), font:String(v.font), fontSize:v.fontSize, fillColor:plain(v.fillColor), strokeColor:plain(v.strokeColor), strokeWidth:v.strokeWidth, applyFill:v.applyFill, applyStroke:v.applyStroke, justification:String(v.justification), tracking:v.tracking, leading:v.leading, autoLeading:v.autoLeading, baselineShift:v.baselineShift, fauxBold:v.fauxBold, fauxItalic:v.fauxItalic, allCaps:v.allCaps, smallCaps:v.smallCaps, horizontalScale:v.horizontalScale, verticalScale:v.verticalScale, tsume:v.tsume, boxText:v.boxText, boxTextSize:plain(v.boxTextSize), boxTextPos:plain(v.boxTextPos), boxAutoFitPolicy:String(v.boxAutoFitPolicy), direction:String(v.direction), firstLineIndent:v.firstLineIndent, spaceBefore:v.spaceBefore, spaceAfter:v.spaceAfter };
  try { return String(v); } catch(e) { return "[unreadable]"; }
}
function props(group, depth) {
  if (depth > 12) { fail("Property depth exceeds 12"); return []; }
  var out=[];
  if (!group || !group.numProperties) return out;
  for (var i=1;i<=group.numProperties;i++) {
    if (++propCount > 20000) { fail("Property count exceeds 20000"); return out; }
    var p=group.property(i); if (!p) continue;
    var q={ index:i, matchName:String(p.matchName), name:String(p.name), type:p.propertyType, enabled:!!p.enabled, expressionEnabled:false, value:null, keys:[], children:[] };
    try { q.expressionEnabled=!!p.expressionEnabled; } catch(e) {}
    if (q.expressionEnabled) fail("Enabled expression at " + p.name);
    if (p.propertyType === PropertyType.PROPERTY) {
      try { q.value=plain(p.value); } catch(e2) { q.value="[unreadable]"; }
      try { for (var k=1;k<=p.numKeys;k++) { if (++keyCount>20000) { fail("More than 20000 keys in source hierarchy"); break; } q.keys.push({time:p.keyTime(k),value:plain(p.keyValue(k)),inType:String(p.keyInInterpolationType(k)),outType:String(p.keyOutInterpolationType(k))}); } } catch(e3) { fail("Cannot read keys on " + p.name); }
    } else q.children=props(p,depth+1);
    out.push(q);
  }
  return out;
}
function visit(comp, depth) {
  if (depth>12) { fail("Composition nesting exceeds 12"); return; }
  if (visiting[comp.id]) { fail("Composition cycle at " + comp.name); return; }
  if (seen[comp.id]) return;
  if (hierarchy.length>=32) { fail("More than 32 reachable compositions"); return; }
  visiting[comp.id]=true;
  var c={id:comp.id,name:String(comp.name),width:comp.width,height:comp.height,duration:comp.duration,frameRate:comp.frameRate,layers:[]};
  hierarchy.push(c);
  for(var i=1;i<=comp.numLayers;i++) {
    if (++layerCount>512) { fail("More than 512 reachable layers"); break; }
    var l=comp.layer(i), src=null, sourceId=null, sourcePath=null, kind="other";
    try { var overrides=l.property("ADBE Layer Overrides"); if (overrides && overrides.numProperties>0) fail("Essential Property overrides are unsupported on " + l.name); } catch(eo) {}
    try { if (l instanceof TextLayer) kind="text"; else if (l instanceof AVLayer) kind="av"; } catch(e) {}
    try { src=l.source; if (src) { sourceId=src.id; if (src instanceof FootageItem) { if (src.file) sourcePath=src.file.fsName.replace(/\\\\/g,"/"); if (src.mainSource && src.mainSource.footageMissing) fail("Missing footage: " + src.name); } } } catch(e2) {}
    c.layers.push({index:i,name:String(l.name),kind:kind,sourceId:sourceId,sourcePath:sourcePath,enabled:!!l.enabled,inPoint:l.inPoint,outPoint:l.outPoint,startTime:l.startTime,stretch:l.stretch,parentIndex:l.parent ? l.parent.index : null,trackMatteType:String(l.trackMatteType),properties:props(l,0)});
    if (src && src instanceof CompItem) visit(src,depth+1);
  }
  delete visiting[comp.id]; seen[comp.id]=true;
}
var root=byId(spec.compId);
if (!app.project.file) fail("Project must be saved");
if (!(root instanceof CompItem)) fail("Target composition ID is missing"); else visit(root,0);
for (var fi=0;fi<spec.fields.length;fi++) {
  var f=spec.fields[fi], c=root, l=null;
  for (var pi=0;pi<f.layerPath.length;pi++) {
    if (!(c instanceof CompItem) || f.layerPath[pi]>c.numLayers) { fail("Invalid path for " + f.key); l=null; break; }
    l=c.layer(f.layerPath[pi]);
    if (pi<f.layerPath.length-1) { try { c=l.source; } catch(e) { c=null; } if (!(c instanceof CompItem)) { fail("Path does not traverse a precomp for " + f.key); l=null; break; } }
  }
  if (!l) continue;
  var isText=(l instanceof TextLayer), isLogo=(l instanceof AVLayer && l.source && l.source instanceof FootageItem);
  if ((f.kind==="text" && !isText) || (f.kind==="logo" && !isLogo)) fail("Field kind mismatch for " + f.key);
  var nk=0, textStyleFingerprint=null; try { if(isText) { var sourceText=l.property("ADBE Text Properties").property("ADBE Text Document"); nk=sourceText.numKeys; textStyleFingerprint=textStyle(sourceText.value,f.key); } } catch(e) { fail("Unreadable Source Text for " + f.key); }
  if (f.kind==="text" && nk>0) fail("Animated Source Text is unsupported for " + f.key);
  fields.push({key:f.key,kind:f.kind,layerPath:f.layerPath,compId:l.containingComp.id,layerIndex:l.index,layerName:String(l.name),sourceId:l.source ? l.source.id : null,sourceTextKeys:nk,textStyleFingerprint:textStyleFingerprint,hasEnabledExpression:false});
}
return {projectPath:app.project.file ? app.project.file.fsName.replace(/\\\\/g,"/") : "",compId:spec.compId,hierarchy:hierarchy,fields:fields,findings:findings};
`;
}

/** Validate offline and return only scoped AE mutation code; no filesystem writes here. */
export function prepareVariants(
  input: VariantsSpec,
  snapshot: VariantsSnapshot,
): { summary: Record<string, unknown>; mutationCode: string } {
  const spec = variantsSpec.parse(input);
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    snapshot.compId !== spec.compId ||
    !snapshot.projectPath ||
    !path.isAbsolute(snapshot.projectPath)
  )
    throw new Error("Snapshot project or composition mismatch");
  if (!Array.isArray(snapshot.findings) || snapshot.findings.length)
    throw new Error(`Unsafe source: ${snapshot.findings?.join("; ") || "missing findings"}`);
  if (
    !Array.isArray(snapshot.hierarchy) ||
    !snapshot.hierarchy.length ||
    snapshot.hierarchy.length > 32 ||
    !Array.isArray(snapshot.fields) ||
    snapshot.fields.length !== spec.fields.length
  )
    throw new Error("Incomplete composition snapshot");
  const comps = new Map(snapshot.hierarchy.map((c) => [c.id, c]));
  if (!comps.has(spec.compId)) throw new Error("Source composition absent from snapshot");
  for (const f of spec.fields) {
    const read = snapshot.fields.find((x) => x.key === f.key);
    if (
      !read ||
      read.kind !== f.kind ||
      JSON.stringify(read.layerPath) !== JSON.stringify(f.layerPath)
    )
      throw new Error(`Field ${f.key} did not resolve uniquely`);
    const comp = comps.get(read.compId);
    const layer = comp?.layers.find((x) => x.index === read.layerIndex);
    if (!layer || layer.name !== read.layerName || layer.sourceId !== read.sourceId)
      throw new Error(`Field ${f.key} readback mismatch`);
    if (
      read.hasEnabledExpression ||
      (f.kind === "text" &&
        (read.sourceTextKeys !== 0 ||
          read.textStyleFingerprint === null ||
          typeof read.textStyleFingerprint !== "string"))
    )
      throw new Error(`Unsupported animation or expression on ${f.key}`);
  }
  for (const c of snapshot.hierarchy)
    for (const l of c.layers) {
      if (l.sourceId !== null && comps.has(l.sourceId) && l.kind !== "av")
        throw new Error("Unexpected precomp source layer");
      if (Array.isArray(l.properties)) l.properties.forEach(rejectExpressions);
    }
  const logoPaths: string[] = [];
  for (const v of spec.variants)
    for (const f of spec.fields)
      if (f.kind === "logo") {
        const file = v.values[f.key];
        if (!path.isAbsolute(file) || !fs.existsSync(file) || !fs.statSync(file).isFile())
          throw new Error(`Logo value for ${f.key} must be an existing absolute file`);
        if (!logoPaths.includes(file)) logoPaths.push(file);
      }
  const summary = {
    projectPath: snapshot.projectPath,
    sourceCompId: spec.compId,
    variantCount: spec.variants.length,
    fieldCount: spec.fields.length,
    variantNames: spec.variants.map((v) => v.name),
    logoPaths,
  };
  const mutationCode = `
var spec=${jsxLiteral(spec)};
var logoPaths=${jsxLiteral(logoPaths)};
function byId(id){for(var i=1;i<=app.project.numItems;i++){var x=app.project.item(i);if(x.id===id)return x;}return null;}
var root=byId(spec.compId), results=[];
if(!(root instanceof CompItem))return {ok:false,error:"Source comp disappeared"};
var imported={};
for(var ai=0;ai<logoPaths.length;ai++){var file=new File(logoPaths[ai]);if(!file.exists)return {ok:false,error:"Logo asset disappeared: "+logoPaths[ai]};var probe=new ImportOptions(file);if(!probe.canImportAs(ImportAsType.FOOTAGE))return {ok:false,error:"Logo asset cannot import as footage: "+logoPaths[ai]};}
for(var ai=0;ai<logoPaths.length;ai++){var file=new File(logoPaths[ai]);var io=new ImportOptions(file);io.importAs=ImportAsType.FOOTAGE;imported[logoPaths[ai]]=app.project.importFile(io);}
for(var vi=0;vi<spec.variants.length;vi++){
  var v=spec.variants[vi], memo={};
  function clone(comp){
    if(memo[comp.id])return memo[comp.id];
    var d=comp.duplicate();memo[comp.id]=d;
    d.name=comp.name+" ["+v.name+"]";
    for(var li=1;li<=d.numLayers;li++){
      var layer=d.layer(li), source=null;
      try{source=layer.source;}catch(e){}
      if(source && source instanceof CompItem)layer.replaceSource(clone(source),false);
    }
    return d;
  }
  var output=clone(root);
  var checks=[];
  for(var fi=0;fi<spec.fields.length;fi++){
    var f=spec.fields[fi], c=output, layer=null;
    for(var pi=0;pi<f.layerPath.length;pi++){
      layer=c.layer(f.layerPath[pi]);
      if(pi<f.layerPath.length-1)c=layer.source;
    }
    if(f.kind==="text"){
      var prop=layer.property("ADBE Text Properties").property("ADBE Text Document");
      var doc=prop.value;doc.text=v.values[f.key];prop.setValue(doc);
      var textReadback=prop.value;
      if(String(textReadback.text)!==v.values[f.key])throw new Error("Text readback mismatch for "+f.key);
      var check={key:f.key,kind:"text",text:String(textReadback.text)};
      try{var rect=layer.sourceRectAtTime(0,false);check.bounds={left:rect.left,top:rect.top,width:rect.width,height:rect.height};}catch(eb){}
      checks.push(check);
    }else{
      layer.replaceSource(imported[v.values[f.key]],false);
      if(layer.source!==imported[v.values[f.key]])throw new Error("Logo source readback mismatch for "+f.key);
      checks.push({key:f.key,kind:"logo",sourceId:layer.source.id,sourceName:String(layer.source.name)});
    }
  }
  results.push({name:v.name,compId:output.id,compName:output.name,checks:checks});
}
return {ok:true,variants:results,diagnostics:[]};
`;
  return { summary, mutationCode };
}
