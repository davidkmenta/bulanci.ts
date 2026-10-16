import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './', // relative URLs so the build also works from Capacitor's file origin
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
