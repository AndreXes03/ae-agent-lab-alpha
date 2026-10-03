import * as path from "node:path";
import { z } from "zod";
import { rejectedOutputPath } from "../config.js";
import { jsxCompPreamble, jsxVal, registerOp } from "../registry.js";

const reviewSpec = z.strictObject({
  comp: z.union([z.string().min(1), z.number().int().positive()]),
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  outputPath: z.string().min(1),
  outputTemplate: z.string().min(1),
  renderTemplate: z.string().min(1).optional(),
});

registerOp({
  name: "render.review",
  category: "render",
  description:
    "Render ONLY a short affected interval (max 10 seconds) via an isolated temporary queue item, then restore other queue flags and remove that item. Frame-aligned bounds; endFrame is exclusive. Supply known templates from render.list_templates. Does not save the project. Native AE execution and output FPS/template fidelity must be reviewed; returns completion/file existence, never aesthetic approval. Do not run after every edit; only for requested/necessary temporal review.",
  params: [
    { name: "comp", type: "any", required: true, description: "Composition name or numeric id" },
    { name: "startFrame", type: "number", required: true, description: "First frame (>=0)" },
    {
      name: "endFrame",
      type: "number",
      required: true,
      description: "Exclusive last frame; interval <=10 seconds",
    },
    {
      name: "outputPath",
      type: "string",
      required: true,
      description: "New absolute movie path; existing files refused",
    },
    {
      name: "outputTemplate",
      type: "string",
      required: true,
      description: "Exact output template from render.list_templates; movie output only",
    },
    {
      name: "renderTemplate",
      type: "string",
      description: "Optional exact render-settings template from render.list_templates",
    },
  ],
  toJsx(raw) {
    const args = reviewSpec.parse(raw);
    if (args.endFrame <= args.startFrame) throw new Error("endFrame must follow startFrame");
    if (!path.isAbsolute(args.outputPath) || rejectedOutputPath(args.outputPath))
      throw new Error("review output must be an absolute path outside the mailbox");
    return `
${jsxCompPreamble(args)}
var _rv=${jsxVal(args)};
var _rq=app.project.renderQueue;
if(_rq.rendering) return {ok:false,error:"render queue already running"};
if((_rv.endFrame-_rv.startFrame)/_comp.frameRate>10 || _rv.endFrame/_comp.frameRate>_comp.duration+0.00001) return {ok:false,error:"review interval exceeds comp or 10 seconds"};
if(/\\[(?:#|0)+\\]/.test(_rv.outputPath)) return {ok:false,error:"movie output required, not an image sequence"};
var _reviewFile=new File(_rv.outputPath);
if(_reviewFile.exists) return {ok:false,error:"review output already exists"};
var _flags=[],_temporary=null,_reviewResult=null,_restoreErrors=[];
try {
  for(var i=1;i<=_rq.numItems;i++) _flags.push({item:_rq.item(i),render:_rq.item(i).render});
  _temporary=_rq.items.add(_comp);
  if(_rv.renderTemplate) _temporary.applyTemplate(_rv.renderTemplate);
  var _om=_temporary.outputModule(1);
  _om.applyTemplate(_rv.outputTemplate);
  _om.file=AE.ensureParentDir(_rv.outputPath);
  _temporary.timeSpanStart=_rv.startFrame/_comp.frameRate;
  _temporary.timeSpanDuration=(_rv.endFrame-_rv.startFrame)/_comp.frameRate;
  _temporary.skipFrames=0;
  for(var j=0;j<_flags.length;j++) if(_flags[j].render) _flags[j].item.render=false;
  _temporary.render=true;
  _rq.render();
  var _done=_temporary.status===RQItemStatus.DONE;
  _reviewFile=new File(_rv.outputPath);
  _reviewResult={ok:_done&&_reviewFile.exists,completed:_done,fileExists:_reviewFile.exists,outputPath:_rv.outputPath,startFrame:_rv.startFrame,endFrame:_rv.endFrame,compFps:_comp.frameRate,outputTemplate:_rv.outputTemplate,temporalReviewRequired:true};
  if(!_reviewResult.ok) _reviewResult.error="review render did not complete with an output file";
} catch(_reviewError) { _reviewResult={ok:false,error:AE.errText(_reviewError)}; }
finally {
  if(_temporary) try { _temporary.remove(); } catch(_removeError) { _restoreErrors.push(AE.errText(_removeError)); }
  for(var k=0;k<_flags.length;k++) try { if(_flags[k].item.render!==_flags[k].render) _flags[k].item.render=_flags[k].render; } catch(_restoreError) { _restoreErrors.push(AE.errText(_restoreError)); }
}
if(_restoreErrors.length) { _reviewResult.ok=false;_reviewResult.restoreErrors=_restoreErrors;_reviewResult.error="review cleanup incomplete"; }
return _reviewResult;
`;
  },
});
