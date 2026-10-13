import fs from 'fs';
import assert from 'assert';
import test from 'node:test';

test('converter.html structure and integrity', () => {
  const html = fs.readFileSync('converter.html', 'utf8');

  // Verify self-contained requirement (zero CDN dependencies; only privacy-friendly Plausible analytics allowed)
  const scriptSrcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => m[1]);
  for (const src of scriptSrcs) {
    assert.ok(src.includes('plausible.io'), `External scripts only allowed for privacy-friendly Plausible analytics, found: ${src}`);
  }
  assert.ok(!html.includes('<link rel="stylesheet" href="http'), 'HTML should have no external stylesheets');

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
  const allScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const engineScript = allScripts.find(m => m[1].includes('MotionPhotoEngine'));
  assert.ok(engineScript, 'Should contain engine script tag');
  const scriptContent = engineScript[1];

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

  // Verify link to lumia tool, privacy, and impressum
  assert.ok(hubHtml.includes('lumia-motion-photo-converter'), 'Hub contains link to lumia-motion-photo-converter');
  assert.ok(hubHtml.includes('href="./timelapse/"'), 'Hub links to the time-lapse creator');
  assert.ok(hubHtml.includes('In-Browser Web Tools'), 'Hub contains main heading');
  assert.ok(hubHtml.includes('pentenrieder.dev'), 'Hub contains pentenrieder.dev branding');
  assert.ok(hubHtml.includes('privacy/'), 'Hub contains link to privacy policy');
  assert.ok(hubHtml.includes('impressum/'), 'Hub contains link to impressum');

  // Verify zero external scripts/styles except privacy-friendly Plausible analytics
  const scriptSrcs = [...hubHtml.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => m[1]);
  for (const src of scriptSrcs) {
    assert.ok(src.includes('plausible.io'), `Hub external scripts only allowed for Plausible, found: ${src}`);
  }
  assert.ok(!hubHtml.includes('<link rel="stylesheet" href="http'), 'Hub has no external stylesheets');
});

test('time-lapse creator is standalone and exposes image, video, and export controls', () => {
  const html = fs.readFileSync('timelapse/index.html', 'utf8');
  const scriptSrcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(match => match[1]);
  assert.deepEqual(scriptSrcs, [], 'Time-lapse creator has no external script dependencies');
  assert.ok(html.includes('id="imageInput"') && html.includes('multiple'), 'Accepts multiple images');
  assert.ok(html.includes('id="dropZone"'), 'Includes drag-and-drop image selection');
  assert.ok(html.includes('id="fps"') && html.includes('id="width"') && html.includes('id="height"'), 'Exposes frame rate and output dimensions');
  assert.ok(html.includes('id="fit"'), 'Exposes image fit setting');
  assert.ok(html.includes('new MediaRecorder(stream'), 'Records the video locally in the browser');
  assert.ok(html.includes("'video/mp4'"), 'Uses MP4 when that is the browser-supported recording format');
  assert.ok(html.includes('width % 2 !== 0'), 'Rejects odd output dimensions');
  assert.ok(html.includes('id="downloadLink"'), 'Provides a video download');

  const referencedIds = [...html.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(match => match[1]);
  for (const id of referencedIds) {
    assert.ok(html.includes(`id="${id}"`), `Time-lapse page contains element with ID "${id}"`);
  }
});

test('impressum and privacy pages exist and exclude medienstudio', () => {
  assert.ok(fs.existsSync('impressum/index.html'), 'impressum/index.html must exist');
  assert.ok(fs.existsSync('impressum.html'), 'impressum.html must exist');
  assert.ok(fs.existsSync('privacy/index.html'), 'privacy/index.html must exist');
  assert.ok(fs.existsSync('privacy.html'), 'privacy.html must exist');

  const impressumHtml = fs.readFileSync('impressum/index.html', 'utf8');
  assert.ok(impressumHtml.includes('Angaben gemäß § 5 TMG'), 'Impressum contains § 5 TMG');
  assert.ok(impressumHtml.includes('Thomas Pentenrieder'), 'Impressum contains Thomas Pentenrieder');
  assert.ok(impressumHtml.includes('Kastanienweg 3a'), 'Impressum contains address');
  assert.ok(impressumHtml.includes('82319 Starnberg'), 'Impressum contains city');
  assert.ok(impressumHtml.includes('plausible.io'), 'Impressum contains Plausible script');
  assert.ok(!impressumHtml.toLowerCase().includes('medienstudio'), 'Impressum MUST NOT contain medienstudio');

  const privacyHtml = fs.readFileSync('privacy/index.html', 'utf8');
  assert.ok(privacyHtml.includes('Datenschutzerklärung'), 'Privacy contains title');
  assert.ok(privacyHtml.includes('Plausible Analytics'), 'Privacy contains Plausible Analytics disclosure');
  assert.ok(privacyHtml.includes('100% Client-Side'), 'Privacy highlights 100% client-side privacy');
  assert.ok(privacyHtml.includes('GitHub Pages'), 'Privacy documents GitHub Pages hosting');
  assert.ok(privacyHtml.includes('Thomas Pentenrieder'), 'Privacy contains responsible person');
  assert.ok(privacyHtml.includes('plausible.io'), 'Privacy contains Plausible script');
  assert.ok(!privacyHtml.toLowerCase().includes('medienstudio'), 'Privacy page MUST NOT contain medienstudio');
});

test('open graph preview images and meta tags', () => {
  assert.ok(fs.existsSync('og-image.png'), 'root og-image.png exists');
  assert.ok(fs.existsSync('lumia-motion-photo-converter/og-image.png'), 'lumia og-image.png exists');

  const filesToCheck = [
    'index.html',
    'converter.html',
    'lumia-motion-photo-converter/index.html',
    'privacy.html',
    'privacy/index.html',
    'impressum.html',
    'impressum/index.html'
  ];

  for (const file of filesToCheck) {
    const html = fs.readFileSync(file, 'utf8');
    assert.ok(html.includes('<meta property="og:image"'), `${file} contains og:image`);
    assert.ok(html.includes('<meta property="og:image:width" content="1200">'), `${file} contains og:image:width`);
    assert.ok(html.includes('<meta property="og:image:height" content="630">'), `${file} contains og:image:height`);
    assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image">'), `${file} contains twitter:card summary_large_image`);
    assert.ok(html.includes('<meta name="twitter:image"'), `${file} contains twitter:image`);
  }
});

