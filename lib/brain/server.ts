import type { McpServer } from "@modelcontextprotocol/server";
import { workspaceGraph } from "@/lib/graph/client";
import { callerFrom } from "./caller";
import { prompts } from "./prompts";
import type { BrainContext } from "./tool";
import { tools } from "./tools";

type HandlerContext = { http?: { authInfo?: Parameters<typeof callerFrom>[0] } };

function contextFor(ctx: HandlerContext): BrainContext {
  const caller = callerFrom(ctx.http?.authInfo);
  return { caller, graph: workspaceGraph(caller.workspace) };
}

export function registerBrain(server: McpServer): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema, annotations: { readOnlyHint: tool.readOnly } },
      async (input, ctx) => {
        const text = await tool.handler(input, contextFor(ctx));
        return { content: [{ type: "text", text }] };
      },
    );
  }
  for (const prompt of prompts) {
    server.registerPrompt(
      prompt.name,
      { description: prompt.description, argsSchema: prompt.argsSchema },
      async (args, ctx) => {
        const text = await prompt.handler(args, contextFor(ctx));
        return { messages: [{ role: "user", content: { type: "text", text } }] };
      },
    );
  }
}
