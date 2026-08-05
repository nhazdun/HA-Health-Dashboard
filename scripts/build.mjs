import { build, context } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/**
 * Write the offline harness with the bundle inlined.
 *
 * The harness used to `import()` dist/ as a sub-resource, and a stale cached
 * copy once hid two whole missing panels for several rounds of debugging.
 * Inlining removes the sub-resource entirely: the page you load is the build
 * you just made, with nothing in between that can serve something older.
 */
function writeHarness() {
  const shell = readFileSync(new URL('../scripts/harness.html', import.meta.url), 'utf8');
  const bundle = readFileSync(new URL('../dist/health-hub-card.js', import.meta.url), 'utf8');
  // A replacer *function* is required: the minified bundle contains `$&`
  // sequences (a variable named `$` followed by `&&`), and a string
  // replacement would expand those as "the matched substring", splicing the
  // marker block back into the middle of the code.
  const inlined = shell.replace(
    /\/\/ ---8<--- BUNDLE ---8<---[\s\S]*?\/\/ ---8<--- \/BUNDLE ---8<---/,
    () => `// ---8<--- BUNDLE ---8<---\n${bundle}\n// ---8<--- /BUNDLE ---8<---`,
  );
  writeFileSync(new URL('../scripts/harness.built.html', import.meta.url), inlined);
}

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
  writeHarness();
}
