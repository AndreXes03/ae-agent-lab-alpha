// Frame analysis and contact-sheet composition, on synthetic images — no
// After Effects involved. The PNG round trip at the end proves the alpha
// channel now survives decodePng, which is what tells "transparent margin"
// from "black bar".

import * as zlib from "node:zlib";

import { describe, expect, it } from "vitest";

import { decodePng, encodePngSrgb8, type DecodedPng } from "../src/color/png16.js";
import { analyzeFrame, composeContactSheet, frameLabel, resample } from "../src/color/sheet.js";

function blank(
  width: number,
  height: number,
  withAlpha: boolean,
  fill: [number, number, number] = [0, 0, 0],
): DecodedPng {
  const rgb = new Float64Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = fill[0];
    rgb[i * 3 + 1] = fill[1];
    rgb[i * 3 + 2] = fill[2];
  }
  return withAlpha
    ? { width, height, rgb, alpha: new Float64Array(width * height), bitDepth: 8 }
    : { width, height, rgb, bitDepth: 8 };
}

function paint(
  img: DecodedPng,
  x0: number,
  y0: number,
  w: number,
  h: number,
  color: [number, number, number],
): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * img.width + x) * 3;
      img.rgb[i] = color[0];
      img.rgb[i + 1] = color[1];
      img.rgb[i + 2] = color[2];
      if (img.alpha) img.alpha[y * img.width + x] = 1;
    }
  }
}

/** Minimal RGBA 8-bit PNG encoder for the alpha round-trip test. */
function encodeRgba(width: number, height: number, rgba: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("analyzeFrame", () => {
  it("measures transparent margins and content bounds on an alpha frame", () => {
    const img = blank(64, 48, true);
    paint(img, 10, 8, 20, 12, [1, 0, 0]);
    const a = analyzeFrame(img);
    expect(a.background.kind).toBe("transparent");
    expect(a.contentBounds).toEqual({ left: 10, top: 8, width: 20, height: 12 });
    expect(a.coverage).toBeCloseTo((20 * 12) / (64 * 48), 6);
    expect(a.edges.top).toMatchObject({ width: 8, kind: "transparent" });
    expect(a.edges.left).toMatchObject({ width: 10, kind: "transparent" });
    expect(a.edges.right).toMatchObject({ width: 64 - 30, kind: "transparent" });
    expect(a.edges.bottom).toMatchObject({ width: 48 - 20, kind: "transparent" });
    expect(a.uniform).toBe(false);
  });

  it("reports letterbox bars as opaque color bands on an RGB frame", () => {
    const img = blank(64, 48, false, [0.5, 0.5, 0.5]);
    paint(img, 0, 0, 64, 6, [0, 0, 0]);
    paint(img, 0, 42, 64, 6, [0, 0, 0]);
    const a = analyzeFrame(img);
    expect(a.edges.top).toEqual({ width: 6, kind: "color", color: [0, 0, 0] });
    expect(a.edges.bottom).toEqual({ width: 6, kind: "color", color: [0, 0, 0] });
    // A column runs black-gray-black: not one color, so no side band.
    expect(a.edges.left.kind).toBe("none");
    expect(a.edges.right.width).toBe(0);
    // Background = the corner color (black); content = the gray band.
    expect(a.background).toEqual({ kind: "color", color: [0, 0, 0] });
    expect(a.contentBounds).toEqual({ left: 0, top: 6, width: 64, height: 36 });
  });

  it("flags a uniform frame", () => {
    const a = analyzeFrame(blank(16, 8, false, [0.2, 0.2, 0.2]));
    expect(a.uniform).toBe(true);
    expect(a.contentBounds).toBeNull();
    expect(a.coverage).toBe(0);
    expect(a.edges.top.width).toBe(8);
    expect(a.edges.left.width).toBe(16);
    expect(a.meanRgb[0]).toBeCloseTo(0.2, 6);
  });
});

describe("resample / composeContactSheet", () => {
  it("area-averages when downscaling", () => {
    const img = blank(4, 4, false);
    paint(img, 0, 0, 2, 2, [1, 1, 1]);
    const out = resample(img, 2, 2);
    expect(out[0]).toBeCloseTo(1, 6); // top-left quadrant fully white
    expect(out[3]).toBeCloseTo(0, 6); // top-right quadrant black
  });

  it("tiles frames with a label strip and reports the layout", () => {
    const frames = [
      blank(64, 48, false, [1, 0, 0]),
      blank(64, 48, false, [0, 1, 0]),
      blank(64, 48, false, [0, 0, 1]),
    ];
    const sheet = composeContactSheet(frames, {
      thumbWidth: 32,
      labels: frames.map((_, i) => frameLabel(i, i * 0.5)),
    });
    expect(sheet.columns).toBe(2);
    expect(sheet.rows).toBe(2);
    expect(sheet.thumbWidth).toBe(32);
    expect(sheet.thumbHeight).toBe(24);
    const gap = 8;
    const labelH = 7 * 2 + 6;
    expect(sheet.width).toBe(gap + 2 * (32 + gap));
    expect(sheet.height).toBe(gap + 2 * (labelH + 24 + gap));
    // Centre of the first tile is the first frame's red.
    const cx = gap + 16;
    const cy = gap + labelH + 12;
    const i = (cy * sheet.width + cx) * 3;
    expect(sheet.rgb[i]).toBeCloseTo(1, 6);
    expect(sheet.rgb[i + 1]).toBeCloseTo(0, 6);
    // The label strip above it carries drawn (bright) pixels.
    let bright = 0;
    for (let y = gap; y < gap + labelH; y++) {
      for (let x = gap; x < gap + 32; x++) {
        if (sheet.rgb[(y * sheet.width + x) * 3] > 0.9) bright++;
      }
    }
    expect(bright).toBeGreaterThan(10);
    // Never upscaled.
    expect(composeContactSheet([blank(20, 10, false)], { thumbWidth: 400 }).thumbWidth).toBe(20);
  });

  it("round-trips through the PNG codec", () => {
    const sheet = composeContactSheet([blank(32, 16, false, [0.5, 0.25, 0])], { thumbWidth: 32 });
    const back = decodePng(encodePngSrgb8(sheet.width, sheet.height, sheet.rgb));
    expect(back.width).toBe(sheet.width);
    expect(back.height).toBe(sheet.height);
    expect(back.alpha).toBeUndefined();
  });
});

describe("decodePng alpha", () => {
  it("keeps the alpha channel of an RGBA file", () => {
    const rgba = new Uint8Array(4 * 2 * 4);
    // Pixel (1,0) opaque red; everything else transparent black.
    rgba.set([255, 0, 0, 255], 4);
    const img = decodePng(encodeRgba(4, 2, rgba));
    expect(img.alpha).toBeDefined();
    expect(img.alpha?.[1]).toBeCloseTo(1, 6);
    expect(img.alpha?.[0]).toBe(0);
    expect(img.rgb[3]).toBeCloseTo(1, 6);
    const a = analyzeFrame(img);
    expect(a.contentBounds).toEqual({ left: 1, top: 0, width: 1, height: 1 });
    expect(a.edges.left).toMatchObject({ width: 1, kind: "transparent" });
  });
});
