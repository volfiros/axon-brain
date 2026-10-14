import { appUrl } from "@/lib/auth";
import { getWorkspace, workspaceResource } from "@/lib/workspaces";

export async function GET(_request: Request, { params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: slug } = await params;
  const workspace = await getWorkspace(slug).catch(() => null);
  if (!workspace) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({
    resource: workspaceResource(slug),
    resource_name: `Axon ${workspace.name}`,
    authorization_servers: [`${appUrl}/api/auth`],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    bearer_methods_supported: ["header"],
  });
}
