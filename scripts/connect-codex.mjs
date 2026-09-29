#!/usr/bin/env node
// Register this checkout's dedicated demo worker, preserving unrelated servers.
import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const server='ae-agent-lab-demo';
const entry=join(root,'dist','index.js');
await access(entry);
const env={AE_MCP_RUNTIME_DIR:join(root,'runtime','demo-session'),AE_MCP_INSTANCE:server,AE_MCP_ENABLE_EVAL:'0',AE_MCP_READONLY:'0'};
const existing=spawnSync('codex',['mcp','get',server,'--json'],{encoding:'utf8'});
if(existing.error) throw existing.error;
if(existing.status===0) {
 const config=JSON.parse(existing.stdout);
 const transport=config.transport;
 if(transport?.command!==process.execPath || JSON.stringify(transport?.args)!==JSON.stringify([entry]) || Object.entries(env).some(([k,v])=>transport?.env?.[k]!==v)) throw new Error('A different ae-agent-lab-demo configuration exists; inspect it before replacing.');
 console.log('Codex demo connection already configured.');
} else {
 if(!/No MCP server named|not found/i.test(existing.stderr+existing.stdout)) throw new Error(existing.stderr||existing.stdout);
 const args=['mcp','add',server];
 for(const [key,value] of Object.entries(env)) args.push('--env',`${key}=${value}`);
 args.push('--',process.execPath,entry);
 const result=spawnSync('codex',args,{stdio:'inherit'});
 if(result.status!==0) process.exit(result.status||1);
}
console.log('Target: named AE worker ae-agent-lab-demo. Start with node scripts/demo-session.mjs start.');
console.log('Existing clients may need a fresh session to load the new MCP tools.');
