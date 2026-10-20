import { defineConfig } from 'vitest/config';

/** `npm run test:samples`: the sample-feed tests, including the end-to-end CLI run (builds dist/). */
export default defineConfig({
  test: {
    include: ['test/sample-feed/**/*.spec.ts'],
    env: { SAMPLE_FEED_E2E: '1' },
    fileParallelism: false,
  },
});
