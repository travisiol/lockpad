import type { ChartResponse } from "@/lib/pons";
import { tokenChart } from "@/lib/market";
import { isAddress } from "@/lib/format";

/** GET /api/token/<address>/chart — one price point per curve trade. */
export async function GET(_request: Request, ctx: RouteContext<"/api/token/[address]/chart">) {
  const { address } = await ctx.params;
  if (!isAddress(address)) {
    return Response.json({ ok: false, error: "address must be a 0x address" }, { status: 400 });
  }
  try {
    const chart = await tokenChart(address);
    if (!chart) return Response.json({ ok: false, error: "unknown token" }, { status: 404 });
    const body: ChartResponse = { ok: true, token: address, ...chart };
    return Response.json(body, { headers: { "cache-control": "public, max-age=15" } });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "chain unreachable" }, { status: 502 });
  }
}
