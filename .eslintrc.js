module.exports = {
  env: {
    browser: true,
    node: true,
    es2020: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "plugin:jsdoc/recommended",
    "prettier",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.json",
    sourceType: "module",
  },
  plugins: ["@typescript-eslint", "prefer-arrow"],
  rules: {
    "@typescript-eslint/no-namespace": "off",
    "no-bitwise": "off",
    "quote-props": ["error", "consistent"],
  },
  ignorePatterns: [".eslintrc.js"]
};
