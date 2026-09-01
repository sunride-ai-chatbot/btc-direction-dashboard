import { defineConfig } from 'vitest/config';

export default defineConfig({
  // vite 5's builtin-module list predates node:sqlite — treat it as external
  ssr: { external: ['node:sqlite'] },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    server: { deps: { external: [/node:sqlite/] } },
  },
});
