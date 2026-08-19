import { NextResponse } from "next/server";

/**
 * Liveness. Answers one question: is this process running?
 *
 * Deliberately checks nothing else. A liveness probe that checks dependencies gets the process
 * killed and restarted when a database blips — which does not fix the database and does remove the
 * only thing that could still serve cached reads. Dependency checks belong in `/api/ready`.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "alive", checkedAt: new Date().toISOString() });
}
