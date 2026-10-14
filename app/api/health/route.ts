import { ping } from "@/lib/graph/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ping();
    return Response.json({ ok: true, falkordb: "up" });
  } catch (err) {
    console.error("Health check failed:", err);
    return Response.json({ ok: false, falkordb: "unreachable" }, { status: 503 });
  }
}
