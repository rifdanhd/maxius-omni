import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Kode hasil generate (OpenAPI Generator) — jangan dilint/diedit manual.
    "lib/tiktok-sdk/**",
    // Skrip E2E Playwright (punya toolchain sendiri di luar project).
    "e2e/**",
  ]),
]);

export default eslintConfig;
