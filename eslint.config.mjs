import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      // Per-developer scratch space for measurement and screenshot scripts; gitignored.
      "apps/console/temp/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      // Python demo agent's local dependency install (GMCP-95); gitignored, and the
      // third-party JS vendored inside some wheels is not this repository's to lint.
      "**/.pydeps/**",
      "**/.venv/**",
      "**/playwright-report/**",
      "**/next-env.d.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/console/tools/figma-*/plugin/**/*.js"],
    languageOptions: { globals: { figma: "readonly", __html__: "readonly" } },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
);
