#!/usr/bin/env node
// First agent-designed edit pass on the real fixture in the named AE worker.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const instance = process.argv[2] || "ae-warm-glow";
const comp = "Warm Glow";
const project = join(root, "demo", "warm-glow-animated.aep");
const evidence = join(root, "demo", "warm-glow");
const client = new Client({ name: "ae-agent-lab-edit", version: "0.0.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "index.js")],
  env: { ...process.env, AE_MCP_INSTANCE: instance, AE_MCP_READONLY: "0", AE_MCP_ENABLE_EVAL: "0" },
});

function unpack(response, label) {
  const raw =
    response.content
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n") || "";
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${label}: non-JSON response: ${raw}`);
  }
  if (response.isError || value.ok === false || value.result?.ok === false) {
    throw new Error(
      `${label}: ${value.errorCode || "AE"} ${value.error || value.result?.error || raw}`,
    );
  }
  console.log(`OK ${label}`);
  return value.result || value;
}
async function call(tool, args, label) {
  return unpack(
    await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 180000 }),
    label,
  );
}
async function op(operation, args) {
  return call("ae_do", { operation, args }, operation);
}

try {
  await client.connect(transport);
  const info=await call("ae_comp_info",{nameOrId:comp},"read saved scene and layer structure");
  for(const name of ["Orange atmosphere","Solar core","Eclipse","Headline"]) {
    if(!info.layers.some(l=>l.name===name)) throw new Error("Missing scene layer: "+name);
  }
  await call("ae_save_project",{path:project},"save animated copy");
  // Render review: first pass had an abrupt halo boundary and clipped yellow.
  await op("effect.add",{comp,layer:"Orange atmosphere",matchName:"ADBE GROW BOUNDS"});
  await op("effect.set_property",{comp,layer:"Orange atmosphere",effectIndex:2,property:[1],value:350});
  await op("effect.move",{comp,layer:"Orange atmosphere",effectIndex:2,toIndex:1});
  await op("effect.set_property",{comp,layer:"Solar core",effectIndex:2,property:[3],value:100});
  await op("effect.set_property",{comp,layer:"Solar core",effectIndex:2,property:[4],value:0.25});
  await op("effect.set_property",{comp,layer:"Solar core",effectIndex:1,property:[2],value:[1,0.76,0.30,1]});
  const key=async(layer,property,keys)=>op("keyframe.apply",{comp,layer,property:["Transform",property],keys:keys.map(([time,value])=>({time,value,interp:"ease"})),replace:true});
  await key("Eclipse","Position",[[0,[1120,450]],[0.6,[1120,450]],[1.8,[1082,402]],[2.8,[1090,411]],[4,[1082,402]]]);
  await key("Orange atmosphere","Opacity",[[0,0],[0.5,5],[1.8,48],[2.6,38],[4,48]]);
  await key("Orange atmosphere","Scale",[[0,[80,80]],[1.8,[108,108]],[2.6,[100,100]],[4,[108,108]]]);
  for(const [layer,y,delay] of [["Headline",365,0.15],["Caption",630,0.4]]) {
    await key(layer,"Position",[[delay,[layer==="Headline"?100:108,y+45]],[delay+0.9,[layer==="Headline"?100:108,y]]]);
    await key(layer,"Opacity",[[delay,0],[delay+0.65,100]]);
  }
  await call("ae_save_project",{},"save revised motion");
  await call("ae_render_frame",{compNameOrId:comp,times:[0,0.5,1,1.8,2.6,3.8],outPath:join(evidence,"after.png"),contactSheet:{},analyze:true},"render motion review");
  console.log("Animated scene ready");
} catch(error) { console.error(error); process.exitCode=1; }
finally { await client.close().catch(()=>{}); }
