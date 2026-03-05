import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";
import onlyWarn from "eslint-plugin-only-warn";

/**
 * Creates a shared ESLint configuration for the repository.
 * Each consuming package must pass its own `import.meta.dirname` so
 * the TypeScript project service can locate the correct tsconfig.json.
 *
 * @param {string} dirname - `import.meta.dirname` from the consuming package's eslint.config.js
 * @returns {import("eslint").Linter.Config[]}
 */
export function createConfig(dirname) {
  return [
    js.configs.recommended,
    eslintConfigPrettier,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: {
          projectService: {
            allowDefaultProject: ["eslint.config.js"],
          },
          tsconfigRootDir: dirname,
        },
      },
    },
    {
      plugins: {
        turbo: turboPlugin,
      },
      rules: {
        "turbo/no-undeclared-env-vars": "warn",
        "@typescript-eslint/no-unused-vars": [
          "warn",
          {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            caughtErrorsIgnorePattern: "^_",
          },
        ],
        "@typescript-eslint/no-deprecated": "error",
      },
    },
    {
      plugins: {
        onlyWarn,
      },
    },
    {
      ignores: ["dist/**", "*.config.js", "eslint.config.js"],
    },
  ];
}
