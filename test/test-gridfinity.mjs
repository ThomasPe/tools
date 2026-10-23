import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('apps/gridfinity source project integrity and configuration', () => {
  const pkgPath = 'apps/gridfinity/package.json';
  assert.ok(fs.existsSync(pkgPath), 'apps/gridfinity/package.json must exist');

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.ok(pkg.dependencies['manifold-3d'], 'Must depend on manifold-3d');
  assert.ok(pkg.dependencies['three'], 'Must depend on three');
  assert.ok(pkg.dependencies['react'], 'Must depend on react');
  assert.ok(pkg.dependencies['lucide-react'], 'Must depend on lucide-react');

  // Verify vite configuration outputs to root gridfinity folder
  const viteConfig = fs.readFileSync('apps/gridfinity/vite.config.ts', 'utf8');
  assert.ok(viteConfig.includes("outDir: path.resolve(__dirname, '../../gridfinity')"), 'Vite must output to ../../gridfinity');
  assert.ok(viteConfig.includes("base: './'"), 'Vite base path must be relative');

  // Verify public assets
  assert.ok(fs.existsSync('apps/gridfinity/public/manifold.wasm'), 'manifold.wasm must exist in public folder');
  assert.ok(fs.existsSync('apps/gridfinity/public/favicon.svg'), 'favicon.svg must exist in public folder');
  assert.ok(fs.existsSync('apps/gridfinity/public/og-image.png'), 'og-image.png must exist in public folder');
});

test('apps/gridfinity index.html metadata and Plausible analytics', () => {
  const html = fs.readFileSync('apps/gridfinity/index.html', 'utf8');

  // Plausible analytics
  assert.ok(html.includes('https://plausible.io/js/pa-wZVsiK0BBSk3fzI7qsbWN.js'), 'Must contain privacy-friendly Plausible script');
  assert.ok(html.includes('window.plausible'), 'Must initialize Plausible analytics');

  // Title and branding
  assert.ok(html.includes('Gridfinity Tool Slot Studio'), 'Must contain application title');
  assert.ok(html.includes('pentenrieder.dev'), 'Must include pentenrieder.dev domain branding');

  // Open Graph & Twitter cards
  assert.ok(html.includes('<meta property="og:title"'), 'Must contain og:title');
  assert.ok(html.includes('<meta property="og:description"'), 'Must contain og:description');
  assert.ok(html.includes('content="https://tools.pentenrieder.dev/gridfinity/og-image.png"'), 'Must contain og:image URL');
  assert.ok(html.includes('<meta property="og:image:width" content="1200"'), 'Must define og:image:width 1200');
  assert.ok(html.includes('<meta property="og:image:height" content="630"'), 'Must define og:image:height 630');
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image"'), 'Must define twitter:card');
});

test('built gridfinity distribution bundle verification', (t) => {
  if (!fs.existsSync('gridfinity/index.html')) {
    t.skip('Skipping build bundle check as gridfinity/ is not yet generated in this environment');
    return;
  }

  const distHtml = fs.readFileSync('gridfinity/index.html', 'utf8');
  assert.ok(distHtml.includes('Gridfinity Tool Slot Studio'), 'Built HTML contains title');
  assert.ok(distHtml.includes('plausible.io'), 'Built HTML retains Plausible analytics');
  assert.ok(distHtml.includes('./assets/'), 'Built HTML uses relative asset paths');
  assert.ok(fs.existsSync('gridfinity/og-image.png'), 'Built directory includes og-image.png');
  assert.ok(fs.existsSync('gridfinity/manifold.wasm'), 'Built directory includes manifold.wasm');
});
