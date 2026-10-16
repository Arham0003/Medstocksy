import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    // src/App.test.tsx is scaffolding from the initial commit. It has never
    // run: the repo had no test runner, it calls vi.mock without importing vi,
    // it needs @testing-library/react which is not a dependency, and it
    // asserts text ("Welcome to Local Stock") that belongs to a different
    // application. Left in place rather than deleted - it should either be
    // repaired into a real smoke test or removed deliberately, and neither is
    // this change's business. Excluded so a green run means something.
    exclude: ['src/App.test.tsx', 'node_modules/**', 'dist/**'],
  },
});
