// test/test-matcher.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBaseName, matchMediaPairs } from '../src/file-matcher.js';

test('parseBaseName classifies Lumia filenames accurately', () => {
  const v = parseBaseName('WP_20140914_20_27_44_Pro.mp4.thm');
  assert.equal(v.base, 'WP_20140914_20_27_44_Pro');
  assert.equal(v.isVideo, true);
  assert.equal(v.isHighRes, false);
  assert.equal(v.isStandardJpg, false);

  const std = parseBaseName('WP_20140914_20_27_44_Pro.jpg');
  assert.equal(std.base, 'WP_20140914_20_27_44_Pro');
  assert.equal(std.isStandardJpg, true);
  assert.equal(std.isVideo, false);
  assert.equal(std.isHighRes, false);

  const hires = parseBaseName('WP_20140914_20_27_44_Pro__highres.jpg');
  assert.equal(hires.base, 'WP_20140914_20_27_44_Pro');
  assert.equal(hires.isHighRes, true);
  assert.equal(hires.isVideo, false);
  assert.equal(hires.isStandardJpg, false);
});

test('parseBaseName handles case insensitivity and alternate extensions', () => {
  const vUpper = parseBaseName('WP_20140914_20_27_44_Pro.MP4.THM');
  assert.equal(vUpper.base, 'WP_20140914_20_27_44_Pro');
  assert.equal(vUpper.isVideo, true);

  const vMp4 = parseBaseName('WP_20140914_20_27_44_Pro.mp4');
  assert.equal(vMp4.base, 'WP_20140914_20_27_44_Pro');
  assert.equal(vMp4.isVideo, true);

  const hiresJpeg = parseBaseName('WP_20140914_20_27_44_Pro__highres.JPEG');
  assert.equal(hiresJpeg.base, 'WP_20140914_20_27_44_Pro');
  assert.equal(hiresJpeg.isHighRes, true);

  const stdJpeg = parseBaseName('WP_20140914_20_27_44_Pro.jpeg');
  assert.equal(stdJpeg.base, 'WP_20140914_20_27_44_Pro');
  assert.equal(stdJpeg.isStandardJpg, true);

  // Non-matching files
  assert.equal(parseBaseName('storyteller.mp4'), null);
  assert.equal(parseBaseName('document.txt'), null);
});

test('matchMediaPairs matches video snippet to both standard and highres photos', () => {
  const fileList = [
    { name: 'WP_20140914_20_27_44_Pro.mp4.thm' },
    { name: 'WP_20140914_20_27_44_Pro.jpg' },
    { name: 'WP_20140914_20_27_44_Pro__highres.jpg' },
    { name: 'WP_20140914_STANDALONE.jpg' },
    { name: 'RUST_20140915_storyteller.mp4' }
  ];

  const result = matchMediaPairs(fileList);
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].targetPhotos.length, 2);
  assert.equal(result.pairs[0].targetPhotos[0].outName, 'WP_20140914_20_27_44_Pro.jpg');
  assert.equal(result.pairs[0].targetPhotos[0].isHighRes, false);
  assert.equal(result.pairs[0].targetPhotos[1].outName, 'WP_20140914_20_27_44_Pro__highres.jpg');
  assert.equal(result.pairs[0].targetPhotos[1].isHighRes, true);
  assert.ok(result.orphans.includes('WP_20140914_STANDALONE.jpg'));
  assert.ok(!result.orphans.includes('RUST_20140915_storyteller.mp4'));
});

test('matchMediaPairs handles single photo pair and empty lists', () => {
  const single = matchMediaPairs([
    { name: 'WP_20140914_01.mp4.thm' },
    { name: 'WP_20140914_01.jpg' }
  ]);
  assert.equal(single.pairs.length, 1);
  assert.equal(single.pairs[0].targetPhotos.length, 1);
  assert.equal(single.pairs[0].targetPhotos[0].outName, 'WP_20140914_01.jpg');
  assert.equal(single.orphans.length, 0);

  const empty = matchMediaPairs([]);
  assert.equal(empty.pairs.length, 0);
  assert.equal(empty.orphans.length, 0);
  assert.equal(empty.win10Images.length, 0);
});

test('parseBaseName classifies Windows 10 Mobile Living Images (*_LI.jpg)', () => {
  const li = parseBaseName('WP_20160123_15_23_26_Pro_LI.jpg');
  assert.equal(li.base, 'WP_20160123_15_23_26_Pro');
  assert.equal(li.isWin10LivingImage, true);
  assert.equal(li.isVideo, false);
  assert.equal(li.isStandardJpg, false);
  assert.equal(li.isHighRes, false);

  const richLi = parseBaseName('WP_20160123_15_23_26_Rich_LI.jpeg');
  assert.equal(richLi.base, 'WP_20160123_15_23_26_Rich');
  assert.equal(richLi.isWin10LivingImage, true);

  const highResLi = parseBaseName('WP_20160123_15_23_26_Pro__highres_LI.jpg');
  assert.equal(highResLi.isWin10LivingImage, true);
  assert.equal(highResLi.isHighRes, true);
});

test('matchMediaPairs groups Windows 10 Mobile Living Images into win10Images without orphaning them', () => {
  const fileList = [
    { name: 'WP_20160123_15_23_26_Pro_LI.jpg' },
    { name: 'WP_20160123_15_23_26_Rich_LI.jpg' },
    { name: 'WP_20140914_20_27_44_Pro.mp4.thm' },
    { name: 'WP_20140914_20_27_44_Pro.jpg' },
    { name: 'STATIC_PHOTO.jpg' }
  ];

  const result = matchMediaPairs(fileList);
  assert.equal(result.pairs.length, 1);
  assert.equal(result.win10Images.length, 2);
  assert.equal(result.win10Images[0].outName, 'WP_20160123_15_23_26_Pro_LI.jpg');
  assert.equal(result.win10Images[1].outName, 'WP_20160123_15_23_26_Rich_LI.jpg');
  assert.deepEqual(result.orphans, ['STATIC_PHOTO.jpg']);
});

