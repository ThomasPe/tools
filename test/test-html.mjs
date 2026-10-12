import fs from 'fs';
import assert from 'assert';
import test from 'node:test';

test('converter.html structure and integrity', () => {
  const html = fs.readFileSync('converter.html', 'utf8');

  // Verify self-contained requirement (no CDN or external scripts/css)
  assert.ok(!html.includes('https://'), 'HTML should have no external https URLs (zero CDN dependencies)');
  assert.ok(!html.includes('http://') || html.includes('http://ns.adobe.com/xap/1.0/'), 'HTML should have no external HTTP requests except XMP schema namespaces');
  assert.ok(!html.includes('<script src='), 'HTML should have no external scripts');
  assert.ok(!html.includes('<link rel="stylesheet" href='), 'HTML should have no external stylesheets');

  // Verify badges
  assert.ok(html.includes('100% Client-Side'), 'Contains 100% Client-Side badge');
  assert.ok(html.includes('Android Motion Photo 1.0'), 'Contains Android Motion Photo 1.0 badge');
  assert.ok(html.includes('Pixel & Windows 11 Compatible'), 'Contains Pixel & Windows 11 Compatible badge');

  // Verify key controls
  assert.ok(html.includes('id="btnSelectFolder"'), 'Contains select folder button');
  assert.ok(html.includes('id="dropZone"'), 'Contains dropzone');
  assert.ok(html.includes('id="btnConvert"'), 'Contains convert button');

  // Verify statistics
  assert.ok(html.includes('id="statTotalFiles"'), 'Contains total files stat');
  assert.ok(html.includes('id="statWin10Photos"'), 'Contains win10 photos stat');
  assert.ok(html.includes('id="statVideoClips"'), 'Contains video clips stat');
  assert.ok(html.includes('id="statStdPhotos"'), 'Contains std photos stat');
  assert.ok(html.includes('id="statHighResPhotos"'), 'Contains high res photos stat');
  assert.ok(html.includes('id="statOrphans"'), 'Contains orphans stat');

  // Verify DOM IDs referenced in JS all exist in HTML
  const idRegex = /getElementById\(['"]([^'"]+)['"]\)/g;
  let match;
  const idsInJs = new Set();
  while ((match = idRegex.exec(html)) !== null) {
    idsInJs.add(match[1]);
  }

  for (const id of idsInJs) {
    const idAttr1 = `id="${id}"`;
    const idAttr2 = `id='${id}'`;
    assert.ok(html.includes(idAttr1) || html.includes(idAttr2), `Expected HTML to contain element with ID "${id}"`);
  }
});

test('converter.html embedded engine functionality', () => {
  const html = fs.readFileSync('converter.html', 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'Should contain script tag');
  const scriptContent = scriptMatch[1];

  // Mock DOM environment to evaluate the engine functions
  const mockGlobal = {
    TextEncoder,
    TextDecoder,
    DataView,
    Uint8Array,
    Map,
    window: {
      addEventListener: () => {}
    },

    document: {
      documentElement: { getAttribute: () => null, setAttribute: () => {} },
      getElementById: () => ({
        addEventListener: () => {},
        classList: { add: () => {}, remove: () => {} },
        style: {},
        textContent: '',
        innerHTML: '',
        appendChild: () => {}
      }),
      createElement: () => ({
        className: '',
        textContent: '',
        style: {},
        appendChild: () => {}
      })
    }
  };

  const fn = new Function('global', `
    with(global) {
      ${scriptContent}
      return window.MotionPhotoEngine;
    }
  `);

  const engine = fn(mockGlobal);
  assert.ok(engine, 'window.MotionPhotoEngine should be exposed');
  assert.strictEqual(typeof engine.spliceMotionPhoto, 'function');
  assert.strictEqual(typeof engine.extractWin10LivingImage, 'function');
  assert.strictEqual(typeof engine.convertWin10LivingImage, 'function');
  assert.strictEqual(typeof engine.matchMediaPairs, 'function');
  assert.strictEqual(typeof engine.parseBaseName, 'function');

  // Test pair matching with engine
  const files = [
    { name: 'WP_20160123_15_23_26_Pro_LI.jpg' },
    { name: 'WP_20140915_14_31_23_Pro.jpg' },
    { name: 'WP_20140915_14_31_23_Pro__highres.jpg' },
    { name: 'WP_20140915_14_31_23_Pro.mp4.thm' },
    { name: 'WP_20140915_14_45_02_Pro.mp4' }, // orphan video or no matching jpg
    { name: 'WP_20140915_22_34_26_Pro.jpg' } // orphan photo
  ];

  const matched = engine.matchMediaPairs(files);
  assert.strictEqual(matched.win10Images.length, 1);
  assert.strictEqual(matched.win10Images[0].outName, 'WP_20160123_15_23_26_Pro_LI.jpg');
  assert.strictEqual(matched.pairs.length, 1);
  assert.strictEqual(matched.pairs[0].targetPhotos.length, 2);
  assert.ok(matched.orphans.includes('WP_20140915_22_34_26_Pro.jpg'));
  assert.ok(!matched.orphans.includes('WP_20160123_15_23_26_Pro_LI.jpg'));
});


test('root index.html (Tools Hub) integrity and navigation', () => {
  const hubHtml = fs.readFileSync('index.html', 'utf8');

  // Verify link to lumia tool
  assert.ok(hubHtml.includes('lumia-motion-photo-converter'), 'Hub contains link to lumia-motion-photo-converter');
  assert.ok(hubHtml.includes('In-Browser Web Tools'), 'Hub contains main heading');
  assert.ok(hubHtml.includes('pentenrieder.dev'), 'Hub contains pentenrieder.dev branding');

  // Verify zero external scripts/styles
  assert.ok(!hubHtml.includes('<script src='), 'Hub has no external scripts');
  assert.ok(!hubHtml.includes('<link rel="stylesheet" href='), 'Hub has no external stylesheets');
});
