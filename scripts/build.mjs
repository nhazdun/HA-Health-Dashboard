import { build, context } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const options = {
  entryPoints: ['src/health-hub-card.js'],
  outfile: 'dist/health-hub-card.js',
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: true,
  // The UI copy is Ukrainian; without this esbuild escapes every Cyrillic
  // character to \uXXXX and roughly doubles the size of that text.
  charset: 'utf8',
  legalComments: 'none',
  banner: {
    js: `/*! Health Hub card v${pkg.version} — Home Assistant custom card. Read-only: renders live entity state, never writes to the recorder. */`,
  },
  define: { __VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('watching…');
} else {
  await build(options);
}
