import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@assets": new URL("./assets", import.meta.url).pathname } },
  test: { include: ["src/tests/**/*.test.{ts,tsx}"], environment: "node" },
});
