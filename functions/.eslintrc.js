// eslint.config.js
const typescriptEslint = require('@typescript-eslint/eslint-plugin');
const typescriptParser = require('@typescript-eslint/parser');
const importPlugin = require('eslint-plugin-import');

module.exports = [
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.dev.json'],
        tsconfigRootDir: __dirname,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': typescriptEslint,
      'import': importPlugin,
    },
    rules: {
      // Copy your rules from the old config
      "quotes": ["error", "double"],
      "require-jsdoc": "off",
      "valid-jsdoc": "off",
      "max-len": ["error", {code: 120}],
      "camelcase": "error",
      "object-curly-spacing": ["error", "never"],
      "indent": ["error", 2],
      "import/no-unresolved": 0,
    },
    ignores: ['/lib/**/*'],
  },
];