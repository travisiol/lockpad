import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Token logos come back from the Pons IPFS gateway; nothing else is
    // remote. Plain <img> is used for them (see TokenLogo); this only keeps
    // next/image adoptable later without a config change.
    remotePatterns: [{ protocol: "https", hostname: "www.ponsfamily.com" }],
  },
};

export default nextConfig;
