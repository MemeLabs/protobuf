import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import jsdoc from "eslint-plugin-jsdoc";
import preferArrow from "eslint-plugin-prefer-arrow";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["lib/", "examples/"]),
  {
    files: ["**/*.ts"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      jsdoc.configs["flat/recommended"],
      prettier,
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2020,
      },
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "prefer-arrow": preferArrow,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "no-bitwise": "off",
      "quote-props": ["error", "consistent"],
    },
  },
]);
