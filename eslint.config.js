// Lint for mistakes, not style: Prettier has the look of the code. The type-aware
// rules are the point, since they catch what the compiler lets through.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: ['./tsconfig.json'], tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-constant-condition': ['error', { checkLoops: false }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-condition': ['error', { allowConstantLoopConditions: true }],
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
    },
  },
  { files: ['**/*.js'], ...tseslint.configs.disableTypeChecked },
  prettier,
);
