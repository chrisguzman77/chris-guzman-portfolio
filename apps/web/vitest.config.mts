import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // Route handlers run in node; component tests opt into jsdom with a
    // `// @vitest-environment jsdom` comment at the top of the file.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
