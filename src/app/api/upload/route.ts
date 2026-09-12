/**
 * Token images.
 *
 *   GET  /api/upload → { enabled, via }   whether uploads are configured
 *   POST /api/upload → { uri }            multipart `file` → ipfs://<cid>
 *
 * Pinning needs a key, so it is the operator's choice:
 *   PINATA_JWT            pin through Pinata (the free tier is plenty)
 *   PONS_IPFS_UPLOAD_URL  forward to any endpoint that takes multipart
 *                         `image` and answers { uri } — Pons' own upload
 *                         is origin-gated, so only if they allow the site
 *
 * With neither, the launch form only offers an image URL, which the
 * router stores as-is. Nothing here is required to launch.
 */
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function config() {
  const pinata = process.env.PINATA_JWT?.trim();
  const custom = process.env.PONS_IPFS_UPLOAD_URL?.trim();
  if (pinata) return { enabled: true, via: "pinata" as const, pinata, custom: undefined };
  if (custom) return { enabled: true, via: "custom" as const, pinata: undefined, custom };
  return { enabled: false, via: null, pinata: undefined, custom: undefined };
}

export async function GET() {
  const c = config();
  return Response.json({ enabled: c.enabled, via: c.via }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const c = config();
  if (!c.enabled) {
    return Response.json({ ok: false, error: "Image uploads are not configured on this pad. Paste an image URL instead." }, { status: 501 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, error: "Expected a multipart form with a `file` field." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ ok: false, error: "No file." }, { status: 400 });
  if (!TYPES.has(file.type)) return Response.json({ ok: false, error: "Use a PNG, JPEG, WebP or GIF." }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) return Response.json({ ok: false, error: "Images must be under 5 MB." }, { status: 400 });

  try {
    if (c.via === "pinata") {
      const body = new FormData();
      body.append("file", file, file.name || "token-image");
      body.append("pinataMetadata", JSON.stringify({ name: `lockpad-${Date.now()}` }));
      const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method: "POST",
        headers: { authorization: `Bearer ${c.pinata}` },
        body,
      });
      const json = (await res.json().catch(() => ({}))) as { IpfsHash?: string };
      if (!res.ok || !json.IpfsHash) {
        return Response.json({ ok: false, error: `Pinata refused the upload (${res.status}).` }, { status: 502 });
      }
      return Response.json({ ok: true, uri: `ipfs://${json.IpfsHash}` });
    }
    const body = new FormData();
    body.append("image", file, file.name || "token-image");
    const res = await fetch(c.custom!, { method: "POST", body });
    const json = (await res.json().catch(() => ({}))) as { uri?: string; error?: string };
    if (!res.ok || !json.uri) {
      return Response.json({ ok: false, error: json.error ?? `Upload endpoint answered ${res.status}.` }, { status: 502 });
    }
    return Response.json({ ok: true, uri: json.uri });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "upload upstream unreachable" }, { status: 502 });
  }
}
