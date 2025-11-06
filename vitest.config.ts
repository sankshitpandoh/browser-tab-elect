import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    threads: false,
    pool: 'forks',
    watch: false,
  },
});


