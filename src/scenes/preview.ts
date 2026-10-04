import type { CompiledScene } from "./model.js";
import { evaluateNode } from "./motion.js";

export const previewLimitations = [
  "SCHEMATIC NOT AE RENDER",
  "Browser text metrics and installed fonts can differ from After Effects; fonts are not embedded.",
  "No effects, masks, blending, 3D, footage, audio, expressions, or native motion blur. Integer frame playback only.",
  "Only groups, rectangles, connector lines and text are supported. Group transforms and compiled ancestor lifetimes propagate to children; group opacity is fixed at 100.",
];
export function safeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
export function previewFrame(scene: CompiledScene, frame: number) {
  return scene.nodes.map((node) => {
    const state = evaluateNode(node, frame);
    return [state.x, state.y, state.opacity, state.rotation, ...state.scale, state.visible ? 1 : 0];
  });
}
export function scenePreviewHtml(scene: CompiledScene): string {
  if (scene.spec.durationFrames * scene.nodes.length > 250000)
    throw new Error("Schematic preview exceeds 250000 node-frame budget; use a shorter scene");
  const frames = Array.from({ length: scene.spec.durationFrames }, (_, frame) =>
    previewFrame(scene, frame),
  );
  const data = safeScriptJson({
    spec: scene.spec,
    nodes: scene.nodes,
    frames,
    limitations: previewLimitations,
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src 'none'; img-src 'none'; connect-src 'none'"><meta name="viewport" content="width=device-width"><title>Local schematic scene preview</title><style>body{background:#17191d;color:#eee;font:15px system-ui;margin:24px}header{color:#ffd56b;font-weight:bold}svg{display:block;background:#08090b;max-width:100%;max-height:65vh;margin:16px 0;border:1px solid #555}input{width:min(650px,70vw)}button{padding:8px 16px}li{margin:6px 0}pre{white-space:pre-wrap;color:#bbb}</style></head><body><header>SCHEMATIC NOT AE RENDER</header><h1 id="name"></h1><svg id="stage" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Schematic scene"></svg><button id="play">Play</button> <button id="pause">Pause</button> <input id="scrub" aria-label="Frame" type="range" min="0" step="1"><output id="frame"></output><ul id="limitations"></ul><details><summary>Hierarchy</summary><pre id="hierarchy"></pre></details><script>
'use strict';const data=${data};
const stage=document.getElementById('stage'),scrub=document.getElementById('scrub'),label=document.getElementById('frame');
stage.setAttribute('viewBox','0 0 '+data.spec.width+' '+data.spec.height);stage.setAttribute('width',data.spec.width);stage.setAttribute('height',data.spec.height);document.getElementById('name').textContent=data.spec.name;scrub.max=data.frames.length-1;
for(const message of data.limitations){const li=document.createElement('li');li.textContent=message;document.getElementById('limitations').appendChild(li)}
const groups=new Map();const ns='http://www.w3.org/2000/svg';
for(const node of data.nodes){const g=document.createElementNS(ns,'g');groups.set(node.id,g);let shape;
if(node.type==='rect'){shape=document.createElementNS(ns,'rect');shape.setAttribute('width',node.width);shape.setAttribute('height',node.height)}
if(node.type==='line'){shape=document.createElementNS(ns,'line');shape.setAttribute('x1',node.linePoints[0][0]);shape.setAttribute('y1',node.linePoints[0][1]);shape.setAttribute('x2',node.linePoints[1][0]);shape.setAttribute('y2',node.linePoints[1][1]);shape.setAttribute('stroke','rgb('+node.color.map(v=>Math.round(v*255)).join(',')+')');shape.setAttribute('stroke-width',node.strokeWidth)}
if(node.type==='text'){shape=document.createElementNS(ns,'text');shape.textContent=node.text||'';shape.setAttribute('y',node.fontSize||24);shape.setAttribute('font-size',node.fontSize||24);shape.setAttribute('font-family',node.font||'sans-serif');shape.setAttribute('xml:space','preserve')}
if(shape){shape.setAttribute('fill','rgb('+node.color.map(v=>Math.round(v*255)).join(',')+')');g.appendChild(shape)}}
for(const node of data.nodes)(node.parent?groups.get(node.parent):stage).appendChild(groups.get(node.id));
document.getElementById('hierarchy').textContent=data.nodes.map(n=>(n.parent?n.parent+' → ':'')+n.id+' ('+n.type+')').join('\\n');
let current=0,playing=false,start=0,base=0;
function draw(f){current=Math.max(0,Math.min(data.frames.length-1,Math.floor(f)));scrub.value=current;label.textContent='Frame '+current+' / '+(data.frames.length-1)+' · '+(current/data.spec.fps).toFixed(2)+' s';data.nodes.forEach((n,i)=>{const s=data.frames[current][i],g=groups.get(n.id);g.setAttribute('transform','translate('+s[0]+' '+s[1]+') rotate('+s[3]+') scale('+s[4]/100+' '+s[5]/100+')');g.setAttribute('opacity',Math.max(0,Math.min(1,s[2]/100)));g.setAttribute('display',s[6]?'inline':'none')})}
function tick(now){if(!playing)return;const f=base+Math.floor((now-start)*data.spec.fps/1000);draw(f);if(f>=data.frames.length-1){playing=false;return}requestAnimationFrame(tick)}
document.getElementById('play').onclick=()=>{if(playing)return;if(current===data.frames.length-1)draw(0);playing=true;base=current;start=performance.now();requestAnimationFrame(tick)};document.getElementById('pause').onclick=()=>{playing=false};scrub.oninput=()=>{playing=false;draw(Number(scrub.value))};draw(0);
</script></body></html>`;
}
