import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { encodePngSrgb8 } from "../src/color/png16.js";
import { renderFrameTool } from "../src/tools/render-frame.js";
import type { AeTransport, EvalRequest, EvalResult } from "../src/transport/AeTransport.js";

function mockTransport(outputDir: string, fail = false) {
  const comp = {
    name: "Main",
    width: 80,
    height: 40,
    displayStartTime: 0,
    resolutionFactor: [1, 1],
    saveFrameToPng(_time: number, file: { fsName: string }) {
      if (fail) throw new Error("render failed");
      const width = 80 / this.resolutionFactor[0];
      const height = 40 / this.resolutionFactor[1];
      writeFileSync(
        file.fsName,
        encodePngSrgb8(width, height, new Float64Array(width * height * 3)),
      );
    },
  };
  const requests: EvalRequest[] = [];
  const transport: AeTransport = {
    async execute(req): Promise<EvalResult> {
      requests.push(req);
      const AE = {
        findCompByNameOrId(name: string) {
          return name === "Main" ? comp : null;
        },
        safeGet(fn: () => unknown, fallback: unknown) {
          try {
            return fn();
          } catch {
            return fallback;
          }
        },
        ensureParentDir(abs: string) {
          return { fsName: abs };
        },
        errText(error: Error) {
          return error.message;
        },
      };
      const result = vm.runInNewContext(`(function () { ${req.code} })()`, {
        AE,
        app: {
          project: {
            workingSpace: "None",
            bitsPerChannel: 8,
            file: { fsName: path.join(outputDir, "copy.aep") },
          },
        },
      });
      return {
        ok: true,
        result,
        error: null,
        errorCode: null,
        stack: null,
        logs: [],
        durationMs: 0,
      };
    },
  };
  return { comp, requests, transport };
}

describe("lightweight frame preview", () => {
  it("bounds quick previews before contacting AE", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ae-preview-"));
    try {
      const { requests, transport } = mockTransport(dir);
      const result = await renderFrameTool.handler(
        {
          compNameOrId: "Main",
          times: [0, 1, 2, 3, 4, 5, 6],
          outPath: path.join(dir, "frame.png"),
          preview: "half",
          colorManaged: "off",
        },
        transport,
      );
      expect(result.isError).toBe(true);
      expect(requests).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restores resolution and reports measured half-size PNG", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ae-preview-"));
    try {
      const { comp, requests, transport } = mockTransport(dir);
      const result = await renderFrameTool.handler(
        {
          compNameOrId: "Main",
          time: 0,
          outPath: path.join(dir, "frame.png"),
          preview: "half",
          colorManaged: "off",
        },
        transport,
      );
      expect(result.isError).toBe(false);
      expect(result.structuredContent?.result).toMatchObject({ size: [40, 20], previewFactor: 2 });
      expect(comp.resolutionFactor.slice()).toEqual([1, 1]);
      expect(requests).toHaveLength(1);
      expect(readFileSync(path.join(dir, "frame.png")).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restores resolution when AE frame capture fails", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ae-preview-"));
    try {
      const { comp, transport } = mockTransport(dir, true);
      const result = await renderFrameTool.handler(
        {
          compNameOrId: "Main",
          time: 0,
          outPath: path.join(dir, "frame.png"),
          preview: "quarter",
          colorManaged: "off",
        },
        transport,
      );
      expect(result.isError).toBe(true);
      expect(comp.resolutionFactor.slice()).toEqual([1, 1]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
