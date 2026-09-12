import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ["", "/launch", "/tokens", "/docs"].map((p) => ({ url: `${site.url}${p}`, lastModified: now }));
}
