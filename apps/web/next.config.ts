import type { NextConfig } from "next";

/*
 * The browser talks to the Express API (artifacts/api-server) through this
 * same-origin rewrite: /api/* proxies to the API server, so the httpOnly
 * session cookie is set on the web origin and no CORS or cross-site cookie
 * configuration is needed. Set API_PROXY_TARGET to the API origin per
 * environment (dev default http://127.0.0.1:3000).
 */
const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep dev-only tooling out of the tab order while dogfooding keyboard flows.
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyTarget}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
