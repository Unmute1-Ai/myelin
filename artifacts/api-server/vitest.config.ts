import { defineConfig } from "vitest/config";

// Tests live in src/ only. `tsc -b` emits compiled copies into dist/, and
// vitest's default include matches those too — running both copies races the
// shared test database against itself, so dist is excluded here.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
