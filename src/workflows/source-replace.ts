import { z } from "zod";
import { jsxVal } from "../registry.js";

export const sourceReplaceSpec = z.strictObject({
  sourceId: z.number().int().positive(),
  newPath: z.string().min(1),
  targets: z
    .array(
      z.strictObject({ compId: z.number().int().positive(), layerId: z.number().int().positive() }),
    )
    .min(1)
    .max(32),
  framing: z.enum(["preserve-pixels", "preserve-normalized"]),
  semanticChange: z.boolean(),
  newWidth: z.number().positive().optional(),
  newHeight: z.number().positive().optional(),
  newSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  annotations: z
    .array(
      z.strictObject({
        compId: z.number().int().positive(),
        layerId: z.number().int().positive(),
        role: z.string().min(1).max(100),
        sourceAnchor: z.tuple([z.number().finite(), z.number().finite()]).optional(),
        coordinates: z.enum(["pixels", "normalized"]).optional(),
      }),
    )
    .max(64)
    .default([]),
});
export type SourceReplaceSpec = z.infer<typeof sourceReplaceSpec>;
interface SourceSnapshot {
  ok: boolean;
  projectPath: string;
  sourceId: number;
  width: number;
  height: number;
  pixelAspect: number;
  uses: Array<{
    compId: number;
    compName: string;
    layerId: number;
    layerIndex: number;
    name: string;
    selected: boolean;
  }>;
  targets: Array<{
    compId: number;
    layerId: number;
    layerIndex: number;
    persistent: unknown;
    maskCount: number;
  }>;
  replacement: { bytes: number; modified: number };
}
export const PERSISTENT_PROPERTIES = `
var _propertyCount=0,_keyCount=0;
function persistent(group,depth) {
 if(depth>12) throw new Error("Property depth exceeds 12");
 var out=[];
 for(var pi=1;pi<=group.numProperties;pi++) {
  if(++_propertyCount>20000) throw new Error("Property budget exceeded");
  var p=group.property(pi), v={index:pi,matchName:p.matchName,name:p.name};
  if(p.propertyType===PropertyType.PROPERTY) {
   _keyCount+=p.numKeys;if(_keyCount>20000)throw new Error("Key budget exceeded");
   if(p.numKeys>512) throw new Error("More than 512 keys on a selected property");
   v.expression=p.canSetExpression?p.expression:null;v.expressionEnabled=p.canSetExpression?p.expressionEnabled:false;
   if(p.propertyValueType===PropertyValueType.NO_VALUE) v.noValue=true;
   else {v.keys=AE.snapshotKeys(p);for(var ki=0;ki<v.keys.length;ki++){var key=v.keys[ki];key.value=AE.valueToJson(key.value);if(key.inInterp!==undefined)key.inInterp=String(key.inInterp);if(key.outInterp!==undefined)key.outInterp=String(key.outInterp);if(key.inEase)key.inEase=AE._serializeEase(key.inEase);if(key.outEase)key.outEase=AE._serializeEase(key.outEase);}v.staticValue=p.numKeys?null:AE.valueToJson(p.valueAtTime(0,true));}
  } else v.children=persistent(p,depth+1);
  out.push(v);
 }
 return out;
}
function layerState(l) {
 _propertyCount=0;_keyCount=0;
 return {timing:[l.inPoint,l.outPoint,l.startTime,l.stretch],parentId:l.parent?l.parent.id:null,
   matteType:String(l.trackMatteType),matteId:l.trackMatteLayer?l.trackMatteLayer.id:null,
   audioEnabled:l.audioEnabled,enabled:l.enabled,properties:persistent(l,0)};
}
`;
export function captureSourceReplace(input: SourceReplaceSpec): string {
  const spec = sourceReplaceSpec.parse(input);
  return `
var spec=${jsxVal(spec)},source=AE.findItemById(spec.sourceId);
if(!source || !(source instanceof FootageItem) || !source.mainSource.isStill) throw new Error("Selective replacement currently requires still-image footage");
if(app.project.numItems>10000) throw new Error("Project item budget exceeded");
var file=new File(spec.newPath);
if(!file.exists) throw new Error("Replacement file missing");
${PERSISTENT_PROPERTIES}
var uses=[],targets=[],scanned=0;
for(var ci=1;ci<=app.project.numItems;ci++) {
 var c=app.project.item(ci);if(!(c instanceof CompItem))continue;
 for(var li=1;li<=c.numLayers;li++) {
  if(++scanned>10000)throw new Error("Layer usage scan exceeds 10000");
  var l=c.layer(li);if(!l.source || l.source.id!==source.id)continue;
  var selected=false;
  for(var ti=0;ti<spec.targets.length;ti++)if(spec.targets[ti].compId===c.id&&spec.targets[ti].layerId===l.id)selected=true;
  uses.push({compId:c.id,compName:c.name,layerId:l.id,layerIndex:li,name:l.name,selected:selected});
  if(selected) {
   if(l.locked)throw new Error("Selected layer is locked");
   if(spec.framing==="preserve-normalized"&&l.threeDLayer)throw new Error("Normalized replacement currently supports inspected 2D layers only");
   var scale=l.property("ADBE Transform Group").property("ADBE Scale"),anchor=l.property("ADBE Transform Group").property("ADBE Anchor Point");
   if(spec.framing==="preserve-normalized"&&(scale.expressionEnabled||anchor.expressionEnabled))throw new Error("Normalized framing cannot rewrite expression-driven Scale or Anchor");
   var masks=l.property("ADBE Mask Parade");
   targets.push({compId:c.id,layerId:l.id,layerIndex:li,persistent:layerState(l),maskCount:masks?masks.numProperties:0});
  }
 }
}
if(targets.length!==spec.targets.length)throw new Error("Selected usage missing, duplicated, or source changed");
return {ok:true,projectPath:app.project.file?app.project.file.fsName:"",sourceId:source.id,width:source.width,height:source.height,pixelAspect:source.pixelAspect,uses:uses,targets:targets,replacement:{bytes:file.length,modified:file.modified.getTime()}};
`;
}
export function prepareSourceReplace(input: SourceReplaceSpec, raw: unknown) {
  const spec = sourceReplaceSpec.parse(input),
    snapshot = raw as SourceSnapshot;
  if (
    !snapshot?.ok ||
    snapshot.sourceId !== spec.sourceId ||
    snapshot.targets?.length !== spec.targets.length
  )
    throw new Error("Invalid replacement snapshot");
  if (!spec.newWidth || !spec.newHeight || !spec.newSha256)
    throw new Error("Replacement dimensions and digest must be inspected before preparing");
  const factor = spec.newWidth / snapshot.width;
  if (
    spec.framing === "preserve-normalized" &&
    Math.abs(factor - spec.newHeight / snapshot.height) > 0.00001
  )
    throw new Error("Normalized framing requires matching aspect ratios");
  if (
    spec.framing === "preserve-normalized" &&
    factor !== 1 &&
    snapshot.targets.some((t) => t.maskCount)
  )
    throw new Error(
      "Resolution change with masks requires explicit mask-coordinate retargeting before replacement",
    );
  const warnings = [
    ...(spec.semanticChange
      ? [
          "Content landmarks may have changed: review contours, callout endpoints, masks and linked annotations even at identical resolution.",
        ]
      : []),
    "Expression and semantic annotation relationships outside the explicit list remain unknown.",
  ];
  return {
    summary: {
      sourceId: spec.sourceId,
      selectedUses: snapshot.uses.filter((u) => u.selected),
      preservedUses: snapshot.uses.filter((u) => !u.selected),
      framing: spec.framing,
      scaleMultiplier: spec.framing === "preserve-normalized" ? 1 / factor : 1,
      replacementDimensions: [spec.newWidth, spec.newHeight],
      warnings,
      annotationsToReview: spec.annotations,
      reviewRequired: true,
    },
    mutationCode: `
var spec=${jsxVal(spec)},oldSource=AE.findItemById(spec.sourceId),changed=[];
${PERSISTENT_PROPERTIES}
var imported=null;
try {
imported=app.project.importFile(new ImportOptions(new File(spec.newPath)));
if(imported.width!==spec.newWidth||imported.height!==spec.newHeight)throw new Error("Replacement dimensions changed");
if(!imported.mainSource.isStill)throw new Error("Replacement must be a still image");
imported.parentFolder=oldSource.parentFolder;
var sx=imported.width/oldSource.width,sy=imported.height/oldSource.height;
if(spec.framing==="preserve-normalized"&&(Math.abs(sx-sy)>0.00001||imported.pixelAspect!==oldSource.pixelAspect))throw new Error("Normalized framing requires matching aspect ratios");
if(spec.framing==="preserve-normalized"&&sx!==1)for(var mi=0;mi<_workflowSnapshot.targets.length;mi++)if(_workflowSnapshot.targets[mi].maskCount)throw new Error("Resolution change with masks requires explicit mask-coordinate retargeting");
function scaleValues(p,factor) {
 var keys=AE.snapshotKeys(p);
 function mul(v){var a=[];for(var d=0;d<v.length;d++)a.push(v[d]*factor);return a;}
 if(!keys.length)p.setValue(mul(p.value));else {
  for(var k=0;k<keys.length;k++){
   keys[k].value=mul(keys[k].value);
   if(keys[k].inEase)for(var ei=0;ei<keys[k].inEase.length;ei++)keys[k].inEase[ei].speed*=Math.abs(factor);
   if(keys[k].outEase)for(var eo=0;eo<keys[k].outEase.length;eo++)keys[k].outEase[eo].speed*=Math.abs(factor);
   if(keys[k].inSpatialTangent)keys[k].inSpatialTangent=mul(keys[k].inSpatialTangent);
   if(keys[k].outSpatialTangent)keys[k].outSpatialTangent=mul(keys[k].outSpatialTangent);
  }
  AE.removeAllKeys(p);AE.applyKeys(p,keys);
 }
}
 for(var ti=0;ti<spec.targets.length;ti++) {
  var target=spec.targets[ti],comp=AE.findItemById(target.compId),layer=AE.findLayerById(comp,target.layerId);
  var before=layerState(layer);
  var previousName=layer.name;
  layer.replaceSource(imported,false);layer.name=previousName;
  changed.push({compId:comp.id,layerId:layer.id,sourceId:imported.id,verification:"pending"});
  if(spec.framing==="preserve-normalized"&&sx!==1){
   var transform=layer.property("ADBE Transform Group");
   scaleValues(transform.property("ADBE Scale"),1/sx);
   scaleValues(transform.property("ADBE Anchor Point"),sx);
  }
  var after=layerState(layer);
  // Only explicitly planned Scale/Anchor values can differ; all other persistent data must match.
  if(spec.framing==="preserve-normalized"&&sx!==1){
   for(var pr=0;pr<before.properties.length;pr++)if(before.properties[pr].matchName==="ADBE Transform Group"){
    var bp=before.properties[pr].children,ap=after.properties[pr].children;
    for(var cp=0;cp<bp.length;cp++)if(bp[cp].matchName==="ADBE Scale"||bp[cp].matchName==="ADBE Anchor Point"){
     var factor=bp[cp].matchName==="ADBE Scale"?1/sx:sx,track=bp[cp];
     function times(v,f){var result=[];for(var vi=0;vi<v.length;vi++)result.push(v[vi]*f);return result;}
     if(track.staticValue)track.staticValue=times(track.staticValue,factor);
     for(var kk=0;kk<track.keys.length;kk++){
      var key=track.keys[kk];key.value=times(key.value,factor);
      if(key.inEase)for(var ie=0;ie<key.inEase.length;ie++)key.inEase[ie].speed*=Math.abs(factor);
      if(key.outEase)for(var oe=0;oe<key.outEase.length;oe++)key.outEase[oe].speed*=Math.abs(factor);
      if(key.inSpatialTangent)key.inSpatialTangent=times(key.inSpatialTangent,factor);
      if(key.outSpatialTangent)key.outSpatialTangent=times(key.outSpatialTangent,factor);
     }
    }
   }
  }
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error("Persistent properties changed unexpectedly");
  if(layer.source.id!==imported.id)throw new Error("Source readback mismatch");
  changed[changed.length-1].verification="persistent-preserved";
 }
 return {ok:true,changedUses:changed,annotationsToReview:spec.annotations,semanticReviewRequired:spec.semanticChange,rollbackPerformed:false};
} catch(e) {return {ok:false,error:AE.errText(e),changedUses:changed,importedSourceId:imported?imported.id:null,rollbackPerformed:false};}
`,
  };
}
