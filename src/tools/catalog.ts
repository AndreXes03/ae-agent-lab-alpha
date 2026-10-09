import { createHash } from "node:crypto";
import { z } from "zod";

import { errorResult } from "../errors.js";
import { denyOperation, denyUnregisteredCategory, policySummary, readOnlyMode } from "../policy.js";
import { listOps, type Operation } from "../registry.js";
import { defineTool, jsonResult } from "./define-tool.js";

/**
 * Operations the current policy allows. The catalog must never advertise
 * something `ae_do` will refuse — a model that plans against a filtered-out
 * operation wastes a round trip and, worse, may conclude the server is broken
 * rather than restricted.
 */
function visibleOps(category?: string): Operation[] {
  return listOps(category).filter((op) => denyOperation(op) === null);
}

function visibleCategories(): string[] {
  const categories = new Set<string>();
  for (const op of visibleOps()) categories.add(op.category);
  return Array.from(categories).sort();
}

function catalogResult(payload: Record<string, unknown>, known?: string) {
  const cacheKey = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return jsonResult(
    known === cacheKey ? { notModified: true, cacheKey } : { ...payload, cacheKey },
  );
}

export const catalogTool = defineTool({
  name: "ae_catalog",
  title: "Operation catalog",
  description:
    "Discover available atomic operations for ae_do. Without args: all categories with their " +
    "operation names. With a category: detailed params per operation. Use detail: summary " +
    "to browse names and descriptions without params, or operations: [exact names] to " +
    "fetch only the schemas needed. Opt into allowPartial to retain available schemas and report unavailable names. Reuse cacheKey via ifNoneMatch; query filters names/descriptions. Only operations this server will execute are listed.",
  group: "operations",
  blockedInReadOnly: false,
  effect: "read",
  inputShape: {
    query: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe(
        "Filter operation names/descriptions; literal case-insensitive terms, not semantic search.",
      ),
    ifNoneMatch: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional()
      .describe(
        "Previously returned cacheKey for this same lookup. Matching policy/schema returns notModified without repeating schemas.",
      ),
    category: z
      .string()
      .max(100)
      .optional()
      .describe(
        "Filter by category. Omit to list all categories with operation counts, then drill into a specific category.",
      ),
    operations: z
      .array(z.string().min(1).max(120))
      .min(1)
      .max(12)
      .refine((names) => new Set(names).size === names.length, "Operation names must be unique")
      .optional()
      .describe("Fetch up to 12 exact operation names, with or without a category."),
    allowPartial: z
      .boolean()
      .optional()
      .describe(
        "For exact-name lookups, return available operations plus per-name errors; default false rejects the entire lookup if any name is unavailable.",
      ),
    detail: z
      .enum(["full", "summary"])
      .optional()
      .describe("full (default) includes params; summary includes names and descriptions only."),
  },
  handler: async (args, _transport) => {
    if (!args.category && !args.operations && !args.query) {
      const summary = visibleCategories().map((c) => ({
        category: c,
        operationCount: visibleOps(c).length,
        operations: visibleOps(c).map((op) => op.name),
      }));
      return catalogResult(
        {
          categories: summary,
          totalOperations: visibleOps().length,
          policy: policySummary(),
          undo: "every ae_do call runs in ONE automatic undo group — a single Ctrl+Z / project.undo reverts the whole call (batch.run included); never open an undo group yourself. undo/redo itself (project.undo, command.execute 16/2035) is the exception: it runs outside the group, so call it alone, never inside batch.run",
          ...(readOnlyMode()
            ? {
                note: "AE_MCP_READONLY=1 — only operations that cannot modify the project are listed.",
              }
            : {}),
        },
        args.ifNoneMatch,
      );
    }
    const ops = visibleOps(args.category);
    if (args.category && ops.length === 0 && !args.operations) {
      const available = visibleCategories();
      const withheld = denyUnregisteredCategory(args.category);
      if (withheld) {
        return errorResult("FORBIDDEN", withheld.message, {
          details: { category: args.category, availableCategories: available },
          hint: withheld.hint,
        });
      }
      const hiddenByPolicy = listOps(args.category).length > 0;
      return errorResult(
        hiddenByPolicy ? "FORBIDDEN" : "UNKNOWN_CATEGORY",
        hiddenByPolicy
          ? `category '${args.category}' exists but every operation in it is blocked by the current policy (${policySummary()})`
          : `no operations in category '${args.category}'`,
        {
          details: { category: args.category, availableCategories: available },
          hint: `Available categories: ${available.join(", ")}`,
        },
      );
    }
    // Check all requested names against the visible set, not the registry.
    // Unknown and policy-withheld names share one response so this lookup
    // cannot reveal whether a hidden operation exists.
    const selected = args.operations
      ? args.operations.map((name) => ops.find((op) => op.name === name))
      : ops.filter(
          (op) =>
            !args.query ||
            args.query
              .toLowerCase()
              .split(/\s+/)
              .every((term) => (op.name + " " + op.description).toLowerCase().includes(term)),
        );
    if (!args.allowPartial && selected.some((op) => !op)) {
      return errorResult(
        "UNKNOWN_OPERATION",
        "one or more requested operations are unavailable; use ae_catalog to list available names",
      );
    }
    const errors = (args.operations ?? []).flatMap((name, index) =>
      selected[index]
        ? []
        : [
            {
              name,
              code: "UNKNOWN_OPERATION",
              message: "operation is unavailable; use ae_catalog to list available names",
              retryable: false,
            },
          ],
    );
    const details = selected
      .filter((op): op is Operation => op !== undefined)
      .map((op) => ({
        name: op.name,
        description: op.description,
        readOnly: op.readOnly === true,
        // Changes the user's AE application configuration: runs only with
        // confirm: true, which the caller may pass only on the user's explicit
        // request. The injected `confirm` param carries the same contract.
        ...(op.appConfig ? { appConfig: true } : {}),
        ...(args.detail === "summary"
          ? {}
          : {
              params: op.params.map((p) => ({
                name: p.name,
                type: p.type,
                required: p.required ?? false,
                description: p.description,
                ...(p.nullable ? { nullable: true } : {}),
                ...(p.default !== undefined ? { default: p.default } : {}),
              })),
            }),
      }));
    return catalogResult(
      {
        ...(args.category ? { category: args.category } : {}),
        operations: details,
        ...(args.operations && args.allowPartial ? { errors } : {}),
      },
      args.ifNoneMatch,
    );
  },
});
