import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".wrangler/**",
      ".local/**",
      "node_modules/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      "src/**/*.ts"
    ],
    languageOptions: {
      globals: {
        ...globals.worker,
        D1Database: "readonly",
        D1PreparedStatement: "readonly",
        R2Bucket: "readonly",
        R2ObjectBody: "readonly"
      }
    }
  },
  {
    files: [
      "scripts/**/*.mjs"
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        Blob: "readonly",
        Headers: "readonly",
        Request: "readonly",
        Response: "readonly",
        ReadableStream: "readonly"
      }
    }
  }
);
