import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
    clearMocks: true,
    restoreMocks: true,
  },
});
