import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
export default defineConfig({
  plugins: [
    {
      name: 'sql-as-text',
      transform(_code, id) {
        if (id.endsWith('.sql'))
          return { code: `export default ${JSON.stringify(readFileSync(id, 'utf8'))}`, map: null };
      },
    },
  ],
  test: { environment: 'node', fileParallelism: false, testTimeout: 30000, hookTimeout: 30000 },
});
