import { finishLink } from "../../../link-handlers";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return finishLink(req, "slack");
}
