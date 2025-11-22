import eslint from "@eslint/js";
import globals from "globals";
import prettierConfig from "eslint-config-prettier";
import prettierPlugin from "eslint-plugin-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: ["dist/**", "node_modules/**", "eslint.config.js"],
    },
    {
        files: ["**/*.js"],
        ...eslint.configs.recommended,
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
    ...tseslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        files: ["**/*.ts"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
            parserOptions: {
                project: "./tsconfig.json",
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            prettier: prettierPlugin,
        },
        rules: {
            "prettier/prettier": "warn",
            "@typescript-eslint/consistent-type-imports": "warn",
            "@typescript-eslint/no-floating-promises": "error",
        },
    },
    prettierConfig,
);
