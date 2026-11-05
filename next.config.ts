import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The Docker image runs .next/standalone/server.js.
  output: "standalone",
};

export default nextConfig;
