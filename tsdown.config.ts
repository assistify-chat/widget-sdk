import { defineConfig } from 'tsdown';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Rolldown does not currently expose `sourcemapExcludeSources` through
// tsdown's typed output options, so strip `sourcesContent` from the emitted
// .map files in a post-build hook. Drop this once the option ships natively.
function stripSourcesContent(distDir: string): void {
  for (const name of readdirSync(distDir)) {
    if (!name.endsWith('.map')) continue;
    const path = join(distDir, name);
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { sourcesContent?: unknown };
    if ('sourcesContent' in parsed) {
      delete parsed.sourcesContent;
      writeFileSync(path, JSON.stringify(parsed));
    }
  }
}

export default defineConfig({
  entry: ['src/index.ts', 'src/react.tsx'],
  format: ['esm'],
  dts: true,
  minify: true,
  target: 'es2022',
  sourcemap: true,
  clean: true,
  external: ['react'],
  hooks: {
    'build:done': () => {
      stripSourcesContent('dist');
    },
  },
});
