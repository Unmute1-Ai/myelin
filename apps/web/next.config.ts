import type { NextConfig } from "next";

/*
 * The browser talks to the Express API (artifacts/api-server) through this
 * same-origin rewrite: /api/* proxies to the API server, so the httpOnly
 * session cookie is set on the web origin and no CORS or cross-site cookie
 * configuration is needed. Set API_PROXY_TARGET to the API origin per
 * environment; the default is the API's documented dev port (its
 * .env.example PORT) — pointing at the web's own port would self-loop.
 */
const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8080";

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
