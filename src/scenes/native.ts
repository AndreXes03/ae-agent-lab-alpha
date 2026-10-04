import { sampleTrack } from "./motion.js";
import type { CompiledScene } from "./model.js";
export function nativeScene(scene: CompiledScene): CompiledScene {
  let keys = 0;
  const nodes = scene.nodes.map((n) => ({
    ...n,
    tracks: n.tracks.map((t) => {
      const sampled = sampleTrack(t);
      keys += sampled.keys.length;
      return sampled;
    }),
  }));
  if (keys > 10000) throw new Error("Scene exceeds native key budget");
  return { ...scene, nodes };
}

/** Fixed ES3 runtime. Caller data is JSON, never executable source. */
export const sceneRuntime = `
var scene=payload.scene, mode=payload.mode, prefix="KYNEM_SCENE_V1:", lp="KYNEM_NODE_V1:";
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function meta(comment,p){if(String(comment||"").indexOf(p)!==0)return null;return JSON.parse(String(comment).substring(p.length));}
function prop(l,k){var t=l.property("ADBE Transform Group");
 if(k==="position")return t.property("ADBE Position");if(k==="anchor")return t.property("ADBE Anchor Point");
 if(k==="opacity")return t.property("ADBE Opacity");if(k==="rotation")return t.property("ADBE Rotate Z");if(k==="scale")return t.property("ADBE Scale");
 if(k==="text")return l.property("ADBE Text Properties").property("ADBE Text Document");
 if(k==="path")return l.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property(1).property("ADBE Vector Shape");
 if(k==="strokeWidth")return l.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property(2).property("ADBE Vector Stroke Width");
 if(k==="size")return l.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property(1).property("ADBE Vector Rect Size");
 if(k==="color")return l.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property(2).property(l.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property(2).matchName==="ADBE Vector Graphic - Stroke"?"ADBE Vector Stroke Color":"ADBE Vector Fill Color");return null;}
function ease(es){var r=[];for(var e=0;e<es.length;e++)r.push({speed:es[e].speed,influence:es[e].influence});return r;}
function val(p,k){var v=p.valueAtTime(0,true);if(k==="path")return {vertices:v.vertices,inTangents:v.inTangents,outTangents:v.outTangents,closed:v.closed};if(k==="text")return {text:v.text,font:v.font,fontSize:v.fontSize,color:v.fillColor};return v;}
function read(l,k){if(k==="parent")return l.parent?{layerId:l.parent.id,managedId:meta(l.parent.comment,lp)}:null;if(k==="timing")return [l.inPoint,l.outPoint];
 var p=prop(l,k),o={value:val(p,k),expression:p.expression||"",expressionEnabled:p.expressionEnabled===true,keys:[]};
 for(var q=1;q<=p.numKeys;q++)o.keys.push({time:p.keyTime(q),value:p.keyValue(q),incoming:String(p.keyInInterpolationType(q)),outgoing:String(p.keyOutInterpolationType(q)),inEase:ease(p.keyInTemporalEase(q)),outEase:ease(p.keyOutTemporalEase(q)),temporalAuto:p.keyTemporalAutoBezier(q),temporalContinuous:p.keyTemporalContinuous(q),spatial:p.isSpatial?{incoming:p.keyInSpatialTangent(q),outgoing:p.keyOutSpatialTangent(q),auto:p.keySpatialAutoBezier(q),continuous:p.keySpatialContinuous(q),roving:p.keyRoving(q)}:null});return o;}
function desired(n){var o={position:{value:[n.x,n.y],keys:[]},anchor:{value:n.type==="rect"?[-n.width/2,-n.height/2]:[0,0],keys:[]},opacity:{value:n.opacity,keys:[]},rotation:{value:n.rotation,keys:[]},scale:{value:n.scale,keys:[]},timing:[n.startFrame/scene.spec.fps,n.endFrame/scene.spec.fps],parent:n.parent||null};
 if(n.type==="rect"){o.size={value:[n.width,n.height],keys:[]};o.color={value:n.color,keys:[]};}
 if(n.type==="line"){o.path={value:{vertices:n.linePoints,inTangents:[[0,0],[0,0]],outTangents:[[0,0],[0,0]],closed:false},keys:[]};o.color={value:n.color,keys:[]};o.strokeWidth={value:n.strokeWidth,keys:[]};}
 if(n.type==="text")o.text={value:{text:n.text,font:n.font||null,fontSize:n.fontSize,color:n.color},keys:[]};
 for(var z=0;z<n.tracks.length;z++){var tr=n.tracks[z];o[tr.property].keys=[];for(var ti=0;ti<tr.keys.length;ti++){var tk=tr.keys[ti],tv=tk.value;o[tr.property].keys.push({frame:tk.frame,value:tv,easing:tk.easing});}}
 return o;}
var comp=null,cm=null;
for(var i=1;i<=app.project.numItems;i++){var item=app.project.item(i),m=meta(item.comment,prefix);if(m&&m.id===scene.spec.id){if(comp)throw new Error("Duplicate managed scene ID");comp=item;if(typeof m.revision!=="string"||!(/^[0-9a-f-]{36}$/i).test(m.revision))throw new Error("Invalid scene baseline revision");
 var baselineFile=new File(payload.baselineDir+"/scene-"+m.revision+"-baseline.json");baselineFile.encoding="UTF-8";if(!baselineFile.exists||baselineFile.length>500000||!baselineFile.open("r"))throw new Error("Scene baseline missing; explicit adoption unsupported");try{cm=JSON.parse(baselineFile.read());}finally{baselineFile.close();}if(cm.id!==m.id)throw new Error("Scene baseline identity mismatch");}}
var layers={},snapshot={projectPath:app.project.file?app.project.file.fsName:null,comp:null,layers:{}},actions=[],conflicts=[];
var compDesired={name:scene.spec.name,width:scene.spec.width,height:scene.spec.height,fps:scene.spec.fps,duration:scene.spec.durationFrames/scene.spec.fps};
if(comp&&comp.frameRate!==scene.spec.fps)throw new Error("Existing scene fps changes are unsupported; prepare a new scene ID");
if(comp){snapshot.comp={id:comp.id,metadata:cm,name:comp.name,width:comp.width,height:comp.height,fps:comp.frameRate,duration:comp.duration};
 for(var ckey in compDesired){if(!same(cm.compDesired[ckey],compDesired[ckey])){if(!same(snapshot.comp[ckey],cm.compLive[ckey])&&!same(snapshot.comp[ckey],compDesired[ckey]))conflicts.push("comp."+ckey);else actions.push({comp:true,key:ckey,value:compDesired[ckey]});}}
 for(var j=1;j<=comp.numLayers;j++){var layer=comp.layer(j),lm=meta(layer.comment,lp);if(lm){if(layers[lm])throw new Error("Duplicate managed node ID");layers[lm]=layer;}}
}
if(cm){for(var removed in cm.nodes){var exists=false;for(var rn=0;rn<scene.nodes.length;rn++)if(scene.nodes[rn].id===removed)exists=true;if(!exists)conflicts.push(removed+": node removal requires an explicit separately reviewed operation");}}
for(var ni=0;ni<scene.nodes.length;ni++){var n=scene.nodes[ni],d=desired(n),l=layers[n.id],base=cm&&cm.nodes[n.id];
 if(!l){if(base)conflicts.push(n.id+": managed layer missing");else actions.push({create:true,id:n.id});continue;}
 if(!base||base.type!==n.type)throw new Error("Managed metadata missing or node type changed; explicit adoption is unsupported");
 if(l.locked||l.threeDLayer||prop(l,"position").dimensionsSeparated)throw new Error("Managed layer locked, 3D or separated dimensions unsupported");
 var live={};for(var k in d){live[k]=read(l,k);if(!same(d[k],base.desired[k])){if((live[k]&&live[k].expression)||!same(live[k],base.live[k]))conflicts.push(n.id+"."+k);else actions.push({id:n.id,key:k,value:d[k]});}}
 snapshot.layers[n.id]={id:l.id,values:live,comment:l.comment};
}
if(JSON.stringify(snapshot).length+JSON.stringify(scene).length*8>400000)throw new Error("Scene baseline exceeds bounded metadata budget; reduce nodes or keys");
if(mode==="capture")return {snapshot:snapshot,summary:{sceneId:scene.spec.id,nodes:scene.nodes.length,changes:actions.length,conflictCount:conflicts.length,conflicts:conflicts.slice(0,20)}};
var newBaseline=new File(payload.baselineDir+"/scene-"+payload.revision+"-baseline.json");if(newBaseline.exists)throw new Error("Scene baseline revision already exists");
if(conflicts.length)throw new Error("Scene conflicts: "+conflicts.join(", "));
if(!same(snapshot,payload.snapshot))throw new Error("Prepared scene changed; no mutation applied");
function write(l,k,d){if(k==="parent"){l.setParentWithJump(d?layers[d]:null);return;}if(k==="timing"){l.inPoint=d[0];l.outPoint=d[1];return;}
 var p=prop(l,k);if(p.expression)throw new Error("Expression guard");for(var a=p.numKeys;a>=1;a--)p.removeKey(a);
 if(k==="text"){var td=p.value;td.text=d.value.text;if(d.value.font)td.font=d.value.font;td.fontSize=d.value.fontSize;td.fillColor=d.value.color;p.setValue(td);var textBase=cm.nodes[meta(l.comment,lp)];if(!textBase||same(read(l,"anchor"),textBase.live.anchor)){var box=l.sourceRectAtTime(0,false);prop(l,"anchor").setValue([box.left,box.top]);if(textBase)textBase.live.anchor=read(l,"anchor");}}else if(k==="path"){var sh=new Shape();sh.vertices=d.value.vertices;sh.inTangents=d.value.inTangents;sh.outTangents=d.value.outTangents;sh.closed=false;p.setValue(sh);}else p.setValue(d.value);
 for(var b=0;b<d.keys.length;b++){var key=d.keys[b];p.setValueAtTime(key.frame/scene.spec.fps,key.value);p.setInterpolationTypeAtKey(b+1,KeyframeInterpolationType.LINEAR,key.easing==="hold"?KeyframeInterpolationType.HOLD:KeyframeInterpolationType.LINEAR);if(p.isSpatial){var zero=[];for(var dim=0;dim<key.value.length;dim++)zero.push(0);p.setSpatialAutoBezierAtKey(b+1,false);p.setSpatialContinuousAtKey(b+1,false);p.setSpatialTangentsAtKey(b+1,zero,zero);p.setRovingAtKey(b+1,false);}}
}
if(!comp){comp=app.project.items.addComp(scene.spec.name||scene.spec.id,compDesired.width,compDesired.height,1,compDesired.duration,compDesired.fps);cm={id:scene.spec.id,compDesired:compDesired,compLive:compDesired,nodes:{}};}
for(var ii=0;ii<scene.nodes.length;ii++){var nn=scene.nodes[ii];if(!layers[nn.id]){var nl;
 if(nn.type==="group")nl=comp.layers.addNull();else if(nn.type==="text")nl=comp.layers.addText(nn.text);else{nl=comp.layers.addShape();var vg=nl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group").property("ADBE Vectors Group");vg.addProperty(nn.type==="line"?"ADBE Vector Shape - Group":"ADBE Vector Shape - Rect");vg.addProperty(nn.type==="line"?"ADBE Vector Graphic - Stroke":"ADBE Vector Graphic - Fill");}
 nl.name=nn.id;nl.comment=lp+JSON.stringify(nn.id);layers[nn.id]=nl;var nd=desired(nn);for(var nk in nd)if(nk!=="parent")write(nl,nk,nd[nk]);}}
for(var ai=0;ai<actions.length;ai++){var ac=actions[ai];if(ac.comp){if(ac.key==="fps")comp.frameRate=ac.value;else comp[ac.key]=ac.value;}else if(!ac.create)write(layers[ac.id],ac.key,ac.value);}
for(var fi=0;fi<scene.nodes.length;fi++){var fn=scene.nodes[fi],fd=desired(fn),fl=layers[fn.id],old=cm.nodes[fn.id];if(!old)write(fl,"parent",fd.parent);var baseline=old||{type:fn.type,desired:{},live:{}};
 for(var fk in fd){if(!old||!same(fd[fk],old.desired[fk]))baseline.live[fk]=read(fl,fk);baseline.desired[fk]=fd[fk];}cm.nodes[fn.id]=baseline;}
for(var ck in compDesired)if(!same(cm.compDesired[ck],compDesired[ck]))cm.compLive[ck]=ck==="fps"?comp.frameRate:comp[ck];cm.compDesired=compDesired;newBaseline.encoding="UTF-8";if(!newBaseline.open("w"))throw new Error("Scene baseline write failed");try{newBaseline.write(JSON.stringify(cm));}finally{newBaseline.close();}comp.comment=prefix+JSON.stringify({id:scene.spec.id,revision:payload.revision});
return {ok:true,sceneId:scene.spec.id,compId:comp.id,changedProperties:actions.length};
`;
