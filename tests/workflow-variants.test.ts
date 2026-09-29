import { describe, expect, it } from "vitest";
import {
  captureVariants,
  prepareVariants,
  variantsSpec,
  type VariantsSnapshot,
  type VariantsSpec,
} from "../src/workflows/variants.js";

const spec: VariantsSpec = {
  compId: 1,
  fields: [{ key: "headline", kind: "text", layerPath: [1, 1] }],
  variants: [
    { name: "A", values: { headline: "First" } },
    { name: "B", values: { headline: "Second" } },
  ],
};
const snapshot: VariantsSnapshot = {
  projectPath: "/tmp/source-copy.aep",
  compId: 1,
  hierarchy: [
    {
      id: 1,
      name: "Main",
      layers: [
        { index: 1, name: "Nested", kind: "av", sourceId: 2, sourcePath: null, properties: [] },
      ],
    },
    {
      id: 2,
      name: "Scene",
      layers: [
        { index: 1, name: "Title", kind: "text", sourceId: null, sourcePath: null, properties: [] },
      ],
    },
  ],
  fields: [
    {
      key: "headline",
      kind: "text",
      layerPath: [1, 1],
      compId: 2,
      layerIndex: 1,
      layerName: "Title",
      sourceId: null,
      sourceTextKeys: 0,
      textStyleFingerprint: "[]",
      hasEnabledExpression: false,
    },
  ],
  findings: [],
};

describe("variants recipe offline", () => {
  it("requires explicit unambiguous fields and complete values", () => {
    expect(
      variantsSpec.safeParse({
        ...spec,
        fields: [spec.fields[0], { ...spec.fields[0], key: "other" }],
      }).success,
    ).toBe(false);
    expect(variantsSpec.safeParse({ ...spec, variants: [{ name: "A", values: {} }] }).success).toBe(
      false,
    );
    expect(
      variantsSpec.safeParse({
        ...spec,
        variants: Array.from({ length: 9 }, (_, i) => ({
          name: String(i),
          values: { headline: "x" },
        })),
      }).success,
    ).toBe(false);
  });

  it("rejects enabled expressions and animated Source Text from readback", () => {
    expect(() =>
      prepareVariants(spec, { ...snapshot, findings: ["Enabled expression at Opacity"] }),
    ).toThrow(/Unsafe source/);
    expect(() =>
      prepareVariants(spec, {
        ...snapshot,
        fields: [{ ...snapshot.fields[0], sourceTextKeys: 1 }],
      }),
    ).toThrow(/Unsupported animation/);
    expect(() =>
      prepareVariants(spec, {
        ...snapshot,
        hierarchy: [
          {
            ...snapshot.hierarchy[0],
            layers: [
              { ...snapshot.hierarchy[0].layers[0], properties: [{ expressionEnabled: true }] },
            ],
          },
          snapshot.hierarchy[1],
        ],
      }),
    ).toThrow(/Enabled expression/);
  });

  it("generates a deterministic readback and clones precomps per variant in a mock AE runtime", () => {
    expect(captureVariants(spec)).toBe(captureVariants(spec));
    const { mutationCode, summary } = prepareVariants(spec, snapshot);
    expect(summary.variantCount).toBe(2);

    let nextId = 10;
    class CompItem {
      id: number;
      name: string;
      layers: Layer[];
      constructor(id: number, name: string, layers: Layer[]) {
        this.id = id;
        this.name = name;
        this.layers = layers;
      }
      get numLayers() {
        return this.layers.length;
      }
      layer(index: number) {
        return this.layers[index - 1];
      }
      duplicate() {
        const copy = new CompItem(
          nextId++,
          this.name,
          this.layers.map((l) => l.copy()),
        );
        project.items.push(copy);
        return copy;
      }
    }
    class Layer {
      source: CompItem | null;
      text: string | null;
      constructor(source: CompItem | null, text: string | null) {
        this.source = source;
        this.text = text;
      }
      copy() {
        return new Layer(this.source, this.text);
      }
      replaceSource(source: CompItem) {
        this.source = source;
      }
      property() {
        return {
          property: () => {
            return {
              value: { text: this.text },
              setValue: (doc: { text: string }) => {
                this.text = doc.text;
              },
            };
          },
        };
      }
    }
    const title = new CompItem(2, "Scene", [new Layer(null, "Original")]);
    const main = new CompItem(1, "Main", [new Layer(title, null)]);
    const project = {
      items: [main, title],
      get numItems() {
        return this.items.length;
      },
      item(i: number) {
        return this.items[i - 1];
      },
    };
    const run = new Function(
      "app",
      "CompItem",
      "File",
      "ImportOptions",
      "ImportAsType",
      mutationCode,
    );
    const result = run(
      { project },
      CompItem,
      () => null,
      () => null,
      { FOOTAGE: 1 },
    ) as {
      ok: boolean;
      variants: { compId: number }[];
    };
    expect(result.ok).toBe(true);
    expect(result.variants).toHaveLength(2);
    const a = project.items.find((x) => x.id === result.variants[0].compId)!;
    const b = project.items.find((x) => x.id === result.variants[1].compId)!;
    expect(a.layer(1).source).not.toBe(title);
    expect(a.layer(1).source).not.toBe(b.layer(1).source);
    expect(a.layer(1).source?.layer(1).text).toBe("First");
    expect(b.layer(1).source?.layer(1).text).toBe("Second");
    expect(title.layer(1).text).toBe("Original");
  });
});
