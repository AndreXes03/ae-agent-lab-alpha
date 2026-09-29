import { mkdtemp, chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { inspectTargetsTool } from "../src/tools/inspect-targets.js";
import type { AeTransport } from "../src/transport/AeTransport.js";
import {
  loadTargetHandle,
  saveTargetHandle,
  targetGuardJsx,
  type TargetHandle,
} from "../src/workflows/targets.js";

const roots: string[] = [];
afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function privateDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "kynem-target-test-"));
  roots.push(root);
  const dir = path.join(root, "refs");
  await mkdir(dir, { mode: 0o700 });
  return dir;
}

const handle: TargetHandle = {
  version: 1,
  projectPath: "/tmp/copied-project.aep",
  compId: 41,
  layerId: 73,
  layerIndex: 2,
  propertyPath: [
    { matchName: "ADBE Transform Group", name: "Transform", index: 2 },
    { matchName: "ADBE Position", name: "Position", index: 1 },
  ],
};

function evaluate(
  h: TargetHandle,
  options: {
    project?: string;
    index?: number;
    layerId?: number;
    propertyName?: string;
    comp?: boolean;
    duplicateMatchName?: boolean;
  } = {},
) {
  class CompItem {}
  const property = { matchName: options.propertyName ?? "ADBE Position", name: "Position" };
  const group = {
    matchName: "ADBE Transform Group",
    name: "Transform",
    numProperties: 1,
    property: () => property,
  };
  const layer = {
    id: options.layerId ?? h.layerId,
    numProperties: options.duplicateMatchName ? 3 : 2,
    property: (index: number) =>
      index === 2 || (options.duplicateMatchName && index === 3)
        ? group
        : { matchName: "ADBE Other", name: "Other" },
  };
  const comp = Object.assign(new CompItem(), {
    numLayers: 3,
    layer: (index: number) => (index === (options.index ?? h.layerIndex) ? layer : { id: 999 }),
  });
  const app = { project: { file: { fsName: options.project ?? h.projectPath } } };
  const AE = {
    findItemById: (id: number) => (id === h.compId && options.comp !== false ? comp : null),
  };
  return new Function("app", "AE", "CompItem", `${targetGuardJsx(h)}; return _targetGuard();`)(
    app,
    AE,
    CompItem,
  ) as { ok: boolean; error?: string; property?: unknown };
}

describe("compact target references", () => {
  it("inspects several explicit targets in one read with bounded values", async () => {
    let calls = 0;
    const transport: AeTransport = {
      execute: async ({ code }) => {
        calls++;
        class CompItem {
          id = 41;
          numLayers = 2;
          layer(index: number) {
            return {
              id: index === 1 ? 73 : 74,
              name: `Layer ${index}`,
              numProperties: 1,
              property: () => ({
                matchName: "ADBE Transform Group",
                name: "Transform",
                numProperties: 1,
                property: () => ({
                  matchName: "ADBE Position",
                  name: "Position",
                  numKeys: 3,
                  value: index === 1 ? [10, 20] : "x".repeat(600),
                }),
              }),
            };
          }
        }
        const comp = new CompItem();
        const app = { project: { file: { fsName: "/tmp/copied-project.aep" } } };
        const AE = {
          findItemById: () => comp,
          safeGet: (fn: () => unknown, fallback: unknown) => {
            try {
              return fn();
            } catch {
              return fallback;
            }
          },
          valueToJson: (v: unknown) => v,
        };
        const result = new Function("app", "AE", "CompItem", code)(app, AE, CompItem);
        return {
          ok: true,
          result,
          error: null,
          errorCode: null,
          stack: null,
          logs: [],
          durationMs: 1,
        };
      },
    };
    const result = await inspectTargetsTool.handler(
      {
        compId: 41,
        targets: [
          {
            layerIndex: 1,
            propertyPath: [{ matchName: "ADBE Transform Group" }, { matchName: "ADBE Position" }],
          },
          {
            layerIndex: 2,
            propertyPath: [{ matchName: "ADBE Transform Group" }, { matchName: "ADBE Position" }],
          },
        ],
      },
      transport,
    );
    expect(result.isError, JSON.stringify(result.structuredContent)).toBe(false);
    expect(calls).toBe(1);
    const targets = result.structuredContent!.targets as Array<{
      ref: string;
      value?: unknown;
      valueTruncated?: boolean;
      numKeys: number;
    }>;
    expect(targets[0].value).toEqual([10, 20]);
    expect(targets[0].numKeys).toBe(3);
    expect(targets[1].value).toBeUndefined();
    expect(targets[1].valueTruncated).toBe(true);
    expect((await loadTargetHandle(targets[0].ref)).propertyPath).toEqual([
      { matchName: "ADBE Transform Group", name: "Transform", index: 1 },
      { matchName: "ADBE Position", name: "Position", index: 1 },
    ]);
  });

  it("stores only identity and rejects path shaped references", async () => {
    const dir = await privateDir();
    const ref = await saveTargetHandle(handle, dir);
    expect(ref).toMatch(/^target:[0-9a-f-]{36}$/);
    expect(await loadTargetHandle(ref, dir)).toEqual(handle);
    await expect(loadTargetHandle("target:../../secret", dir)).rejects.toThrow(
      "invalid target reference",
    );
  });

  it("rejects substituted directory and symlink files", async () => {
    const dir = await privateDir();
    const ref = await saveTargetHandle(handle, dir);
    const id = ref.slice("target:".length);
    const { unlink } = await import("node:fs/promises");
    await unlink(path.join(dir, `${id}.json`));
    const external = path.join(path.dirname(dir), "external.json");
    await writeFile(external, JSON.stringify(handle), { mode: 0o600 });
    await symlink(external, path.join(dir, `${id}.json`));
    await expect(loadTargetHandle(ref, dir)).rejects.toThrow();
    await chmod(dir, 0o777);
    await expect(saveTargetHandle(handle, dir)).rejects.toThrow("mode 0700");
  });

  it("resolves the current target and rejects changed project, comp, layer, index or property", () => {
    expect(evaluate(handle).ok).toBe(true);
    expect(evaluate(handle, { project: "/tmp/other.aep" }).error).toMatch(/project changed/);
    expect(evaluate(handle, { comp: false }).error).toMatch(/composition deleted/);
    expect(evaluate(handle, { index: 1 }).error).toMatch(/reordered/);
    expect(evaluate(handle, { layerId: 90 }).error).toMatch(/reordered/);
    expect(evaluate(handle, { propertyName: "ADBE Scale" }).error).toMatch(
      /property deleted or reordered/,
    );
    expect(evaluate(handle, { duplicateMatchName: true }).error).toMatch(/ambiguous/);
  });
});
