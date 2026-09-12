import type { SummaryResponse } from "@/lib/pons";
import { tokenSummary } from "@/lib/market";
import { isAddress } from "@/lib/format";

/** GET /api/token/<address>/summary — metadata, market and both locks, live. */
export async function GET(_request: Request, ctx: RouteContext<"/api/token/[address]/summary">) {
  const { address } = await ctx.params;
  if (!isAddress(address)) {
    return Response.json({ ok: false, error: "address must be a 0x address" }, { status: 400 });
  }
  try {
    const result = await tokenSummary(address);
    if (!result) return Response.json({ ok: false, error: "unknown token" }, { status: 404 });
    const body: SummaryResponse = { ok: true, ...result };
    return Response.json(body, { headers: { "cache-control": "public, max-age=10" } });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "chain unreachable" }, { status: 502 });
  }
}
