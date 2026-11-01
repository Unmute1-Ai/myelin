import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
    // globals: Testing Library cleanup is handled explicitly in tests/setup.ts,
    // but dashboard tests address test/expect through globals — keeping the
    // flag on keeps both suites' styles working under one config.
    globals: true,
  },
});
