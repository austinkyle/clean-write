import eslint from '@eslint/js';
import next from 'eslint-config-next';

const config = [
  eslint.configs.recommended,
  ...next,
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'data/**'],
  },
];

export default config;
