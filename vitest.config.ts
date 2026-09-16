import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The converter walks real DOM nodes, so tests need a DOM implementation.
    // jsdom supports open shadow roots, which is what acquire.ts is built around.
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
});
