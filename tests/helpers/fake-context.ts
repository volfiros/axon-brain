import type { Params, Row } from "@/lib/graph/client";
import type { Caller } from "@/lib/brain/caller";
import type { BrainContext } from "@/lib/brain/tool";

export type Call = { cypher: string; params: Params; readOnly: boolean };

/**
 * A BrainContext whose graph answers from `respond` instead of FalkorDB and records every call.
 * `respond` gets the Cypher and params and returns the rows for that query.
 */
export function fakeContext(
  respond: (cypher: string, params: Params) => Row[] = () => [],
  caller: Partial<Caller> = {},
): { ctx: BrainContext; calls: Call[] } {
  const calls: Call[] = [];
  const run = (readOnly: boolean) => async <T>(cypher: string, params: Params = {}) => {
    calls.push({ cypher, params, readOnly });
    return respond(cypher, params) as T[];
  };
  const ctx: BrainContext = {
    graph: { name: "test_graph", query: run(false), roQuery: run(true) },
    caller: { personId: "p_caller", name: "Casey", role: "Member", teams: [], workspace: "acme", ...caller },
  };
  return { ctx, calls };
}
