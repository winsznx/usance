import { loadInstance } from "@/lib/sentinel-read";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ outcome: "NOT_FOUND" }, { status: 400 });
  return Response.json(await loadInstance(id));
}
