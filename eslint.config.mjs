import eslintPluginAstro from 'eslint-plugin-astro';
import eslintPluginReact from 'eslint-plugin-react';
import eslintPluginReactHooks from 'eslint-plugin-react-hooks';
import eslintPluginJsxA11y from 'eslint-plugin-jsx-a11y';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import js from '@eslint/js';

export default tseslint.config(
  // Global ignore
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.astro/**', '**/.agent/**'],
  },

  // Base JS/TS configuration
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // React configuration
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    plugins: {
      react: eslintPluginReact,
      'react-hooks': eslintPluginReactHooks,
      'jsx-a11y': eslintPluginJsxA11y,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...eslintPluginReact.configs.recommended.rules,
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginJsxA11y.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off', // Not needed in React 17+ or Astro
      'react/no-unknown-property': 'off', // Conflicts with some Astro/Web Component patterns
    },
  },

  // Astro configuration
  ...eslintPluginAstro.configs.recommended,

  // Custom rules override
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn', // Downgrade to warning for now as codebase has some anys
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },

  // Prettier must be last to override conflicting rules
  eslintConfigPrettier,
);
