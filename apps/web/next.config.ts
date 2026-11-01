import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep dev-only tooling out of the tab order while dogfooding keyboard flows.
  devIndicators: false,
};

export default nextConfig;
