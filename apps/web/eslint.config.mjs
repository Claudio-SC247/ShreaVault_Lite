import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "next-env.d.ts",
      "node_modules/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      "scripts/**/*.mjs"
    ],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: [
      "**/*.{ts,tsx}"
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      }
    },
    plugins: {
      "@next/next": nextPlugin,
      "react-hooks": reactHooks
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules
    }
  }
);
