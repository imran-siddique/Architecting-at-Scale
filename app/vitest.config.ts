import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.spec.ts', 'services/**/test/**/*.spec.ts'],
    environment: 'node',
  },
});
