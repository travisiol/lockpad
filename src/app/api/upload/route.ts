/**
 * POST /api/upload — token image → IPFS via Pons.
 *
 * Forwards the multipart body to PONS_IPFS_UPLOAD_URL and returns whatever
 * it says. Without that variable this answers 501 and names it, so the
 * launch form can explain exactly what is missing instead of failing late.
 */
export async function POST(request: Request) {
  const upstream = process.env.PONS_IPFS_UPLOAD_URL?.trim();
  if (!upstream) {
    return Response.json(
      { ok: false, error: "PONS_IPFS_UPLOAD_URL is not configured" },
      { status: 501 },
    );
  }
  try {
    const res = await fetch(upstream, {
      method: "POST",
      body: await request.arrayBuffer(),
      headers: { "content-type": request.headers.get("content-type") ?? "application/octet-stream" },
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "upload upstream unreachable" },
      { status: 502 },
    );
  }
}
