import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: { formats: ["image/avif", "image/webp"] },
  // Umami tracker and collector served first-party, so blockers of analytics domains skip them.
  async rewrites() {
    return [
      { source: "/stats/script.js", destination: "http://umami:3000/script.js" },
      { source: "/stats/api/send", destination: "http://umami:3000/api/send" },
    ];
  },
};

export default nextConfig;
