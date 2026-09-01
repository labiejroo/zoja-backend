import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.spec.ts"],
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.module.ts", "src/main.ts", "src/lambda.ts"],
    },
  },
  esbuild: {
    // TypeORM i Nest opierają się na metadanych dekoratorów.
    target: "es2023",
  },
});
