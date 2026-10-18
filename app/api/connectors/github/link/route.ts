import { startLink } from "../../link-handlers";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return startLink(req, "github");
}
