import { z } from "zod";
import { defineTool } from "../tool";

export default defineTool({
  name: "whoami",
  description: "Shows who you are in this Axon workspace: your Person, Role, Teams and the Workspace.",
  inputSchema: z.object({}),
  readOnly: true,
  async handler(_input, { caller, graph }) {
    return [
      `Person: ${caller.name} (${caller.personId})`,
      `Role: ${caller.role}`,
      `Teams: ${caller.teams.length ? caller.teams.join(", ") : "none"}`,
      `Workspace: ${caller.workspace} (graph ${graph.name})`,
    ].join("\n");
  },
});
