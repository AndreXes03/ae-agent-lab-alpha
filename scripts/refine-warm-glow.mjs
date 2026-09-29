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
 await call("ae_comp_info",{nameOrId:comp},"verify scene");
 await op("keyframe.apply",{comp,layer:"Orange atmosphere",property:["Transform","Opacity"],keys:[{time:0,value:0}],replace:true});
 await op("effect.add",{comp,layer:"Background",matchName:"ADBE Ramp"});
 for(const [property,value] of [[1,[1120,450]],[2,[0.45,0.09,0.012,1]],[3,[1640,450]],[4,[0.018,0.014,0.012,1]],[5,2],[6,8]])
   await op("effect.set_property",{comp,layer:"Background",effectIndex:1,property:[property],value});
 await op("keyframe.apply",{comp,layer:"Background",property:["Effects","ADBE Ramp","ADBE Ramp-0002"],keys:[{time:0,value:[0.018,0.014,0.012,1],interp:"ease"},{time:1.8,value:[0.45,0.09,0.012,1],interp:"ease"},{time:2.6,value:[0.3,0.055,0.006,1],interp:"ease"},{time:4,value:[0.45,0.09,0.012,1],interp:"ease"}],replace:true});
 await call("ae_save_project",{},"save halo correction");
 await call("ae_render_frame",{compNameOrId:comp,time:1.8,outPath:join(evidence,"hero.png")},"render corrected halo");
} catch(error) { console.error(error);process.exitCode=1; }
finally {await client.close().catch(()=>{});}
