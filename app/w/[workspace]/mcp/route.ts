import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { authenticate } from "@/lib/brain/caller";
import { instructions } from "@/lib/brain/instructions";
import { registerBrain } from "@/lib/brain/server";

export const dynamic = "force-dynamic";

const mcp = createMcpHandler(registerBrain, {
  serverInfo: { name: "axon", version: "0.1.0" },
  instructions,
});

async function handle(request: Request, { params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  // The workspace comes only from the URL (ADR 0003), so a token for one workspace cannot read another.
  const authed = withMcpAuth(mcp, (_req, token) => authenticate(token, workspace), { required: true });
  return authed(request);
}

export { handle as GET, handle as POST, handle as DELETE };
