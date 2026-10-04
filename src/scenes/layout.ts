import type { ResolvedNode } from "./model.js";
export function resolveLayout(
  nodes: ResolvedNode[],
  width: number,
  height: number,
): ResolvedNode[] {
  const result = nodes.map((node) => ({ ...node }));
  const byId = new Map(result.map((node) => [node.id, node]));
  for (const node of result) {
    const parent = node.parent ? byId.get(node.parent)! : undefined;
    if (parent?.layout) {
      if (node.anchor !== "top-left")
        throw new Error(`Node ${node.id}: anchors inside layouts are unsupported`);
      continue;
    }
    const w = parent?.width ?? width,
      h = parent?.height ?? height;
    if (node.anchor === "center") {
      node.x += (w - node.width) / 2;
      node.y += (h - node.height) / 2;
    }
    if (node.anchor === "bottom-right") {
      node.x += w - node.width;
      node.y += h - node.height;
    }
  }
  for (const parent of result.filter((node) => node.layout)) {
    const children = result.filter((node) => node.parent === parent.id);
    const layout = parent.layout!;
    if (layout.type === "stack") {
      let offset = layout.padding;
      for (const child of children) {
        child.x += layout.direction === "horizontal" ? offset : layout.padding;
        child.y += layout.direction === "vertical" ? offset : layout.padding;
        offset += (layout.direction === "horizontal" ? child.width : child.height) + layout.gap;
      }
    } else {
      const cellWidth = Math.max(0, ...children.map((node) => node.width));
      const cellHeight = Math.max(0, ...children.map((node) => node.height));
      children.forEach((child, i) => {
        child.x += layout.padding + (i % layout.columns) * (cellWidth + layout.gap);
        child.y += layout.padding + Math.floor(i / layout.columns) * (cellHeight + layout.gap);
      });
    }
  }
  return result;
}
