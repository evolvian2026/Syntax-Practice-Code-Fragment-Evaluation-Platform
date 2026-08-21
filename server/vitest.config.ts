import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // Tests run against a throwaway database, never the development one.
    env: {
      NODE_ENV: 'test',
      DATABASE_FILE: '.tmp/test.db',
      JWT_SECRET: 'test-secret',
      AI_ENABLED: 'false',
    },
  },
});
