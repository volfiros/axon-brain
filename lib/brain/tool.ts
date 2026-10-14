import type { z } from "zod";
import type { AxonGraph } from "@/lib/graph/client";
import type { Caller } from "./caller";

export type BrainContext = { graph: AxonGraph; caller: Caller };

export type BrainTool<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  description: string;
  inputSchema: S;
  readOnly: boolean;
  handler(input: z.output<S>, ctx: BrainContext): Promise<string>;
};

export type BrainPrompt<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  description: string;
  argsSchema: S;
  handler(args: z.output<S>, ctx: BrainContext): Promise<string>;
};

export function defineTool<S extends z.ZodObject>(tool: BrainTool<S>): BrainTool {
  return tool as unknown as BrainTool;
}

export function definePrompt<S extends z.ZodObject>(prompt: BrainPrompt<S>): BrainPrompt {
  return prompt as unknown as BrainPrompt;
}
