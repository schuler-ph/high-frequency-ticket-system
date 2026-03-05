import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReact from "eslint-plugin-react";
import globals from "globals";
import { createConfig } from "./base.js";

/**
 * A custom ESLint configuration for libraries that use React.
 * Pass your package's `import.meta.dirname` to ensure correct tsconfig resolution.
 *
 * @param {string} dirname - `import.meta.dirname` from the consuming package's eslint.config.js
 * @returns {import("eslint").Linter.Config[]}
 */
export function createReactConfig(dirname) {
  return [
    ...createConfig(dirname),
    js.configs.recommended,
    eslintConfigPrettier,
    ...tseslint.configs.recommended,
    pluginReact.configs.flat.recommended,
    {
      languageOptions: {
        ...pluginReact.configs.flat.recommended.languageOptions,
        globals: {
          ...globals.serviceworker,
          ...globals.browser,
        },
      },
    },
    {
      plugins: {
        "react-hooks": pluginReactHooks,
      },
      settings: { react: { version: "detect" } },
      rules: {
        ...pluginReactHooks.configs.recommended.rules,
        // React scope no longer necessary with new JSX transform.
        "react/react-in-jsx-scope": "off",
      },
    },
  ];
}
