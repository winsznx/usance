import { listInstances } from "@/lib/sentinel-read";

/**
 * Owner-bound Sentinel instance list.
 *
 * Read server-side and returned as plain JSON, matching `/api/account`: the client page holds the
 * connected address (from the session), asks here, and never reads the chain in the browser.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const owner = new URL(req.url).searchParams.get("owner");
  if (!owner || !/^0x[0-9a-fA-F]{40}$/.test(owner)) {
    return Response.json({ outcome: "UNREADABLE", reason: "A valid owner address is required." }, { status: 400 });
  }
  const result = await listInstances(owner as `0x${string}`);
  return Response.json(result);
}
