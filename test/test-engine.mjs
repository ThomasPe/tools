// test/test-engine.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createXmpPacket, createApp1XmpSegment, spliceMotionPhoto, extractWin10LivingImage, convertWin10LivingImage } from '../src/motion-photo-engine.js';


test('createXmpPacket generates valid XML containing Camera and Container namespaces', () => {
  const xml = createXmpPacket(123456);
  assert.ok(xml.includes('xmlns:Camera="http://ns.google.com/photos/1.0/camera/"'));
  assert.ok(xml.includes('xmlns:Container="http://ns.google.com/photos/1.0/container/"'));
  assert.ok(xml.includes('<Camera:MotionPhoto>1</Camera:MotionPhoto>'));
  assert.ok(xml.includes('Item:Semantic="MotionPhoto"'));
  assert.ok(xml.includes('Item:Length="123456"'));
  assert.ok(xml.includes('<GCamera:MicroVideoOffset>123456</GCamera:MicroVideoOffset>'));
});

test('createApp1XmpSegment formats valid APP1 marker and header', () => {
  const xml = '<test/>';
  const segment = createApp1XmpSegment(xml);
  assert.equal(segment[0], 0xFF);
  assert.equal(segment[1], 0xE1);
  const view = new DataView(segment.buffer, segment.byteOffset, segment.byteLength);
  const length = view.getUint16(2, false);
  assert.equal(length, segment.length - 2);
  const header = new TextDecoder().decode(segment.subarray(4, 33));
  assert.equal(header, 'http://ns.adobe.com/xap/1.0/\0');
});

test('spliceMotionPhoto injects XMP and appends video stream after JPEG EOI', () => {
  // Minimal valid synthetic JPEG: SOI (FF D8) + APP0 (FF E0 00 04 00 00) + EOI (FF D9)
  const syntheticJpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00, 0xFF, 0xD9]);
  const syntheticVideo = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]); // ftyp box

  const result = spliceMotionPhoto(syntheticJpeg, syntheticVideo);
  // Must start with SOI
  assert.equal(result[0], 0xFF);
  assert.equal(result[1], 0xD8);
  // Must contain XMP APP1 segment
  assert.equal(result[2], 0xFF);
  assert.equal(result[3], 0xE1);
  // Must end with the video stream
  const trailingVideo = result.subarray(result.length - syntheticVideo.length);
  assert.deepEqual(trailingVideo, syntheticVideo);
});

test('spliceMotionPhoto throws error when JPEG lacks SOI marker', () => {
  const invalidJpeg = new Uint8Array([0x00, 0x00, 0xFF, 0xD9]);
  const syntheticVideo = new Uint8Array([0x00, 0x00, 0x00, 0x18]);
  assert.throws(() => spliceMotionPhoto(invalidJpeg, syntheticVideo), {
    message: 'Invalid JPEG: Missing SOI marker (FF D8)'
  });
});

test('spliceMotionPhoto places XMP after existing EXIF APP1 segment', () => {
  // SOI (FF D8) + EXIF APP1 (FF E1, length 8: 00 08, 'Exif\0\0') + EOI (FF D9)
  const exifSegment = [0xFF, 0xE1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  const syntheticJpegWithExif = new Uint8Array([
    0xFF, 0xD8,
    ...exifSegment,
    0xFF, 0xD9
  ]);
  const syntheticVideo = new Uint8Array([0x00, 0x00, 0x00, 0x18]);

  const result = spliceMotionPhoto(syntheticJpegWithExif, syntheticVideo);
  // First is SOI
  assert.equal(result[0], 0xFF);
  assert.equal(result[1], 0xD8);
  // Next is EXIF APP1
  assert.equal(result[2], 0xFF);
  assert.equal(result[3], 0xE1);
  const exifHeader = new TextDecoder().decode(result.subarray(6, 12));
  assert.equal(exifHeader, 'Exif\0\0');
  // Right after EXIF APP1 segment (offset 2 + 10 = 12), the injected XMP APP1 should appear
  assert.equal(result[12], 0xFF);
  assert.equal(result[13], 0xE1);
  const xmpHeader = new TextDecoder().decode(result.subarray(16, 45));
  assert.equal(xmpHeader, 'http://ns.adobe.com/xap/1.0/\0');
});

test('extractWin10LivingImage returns null on null, non-JPEG, or regular JPEG', () => {
  assert.equal(extractWin10LivingImage(null), null);
  assert.equal(extractWin10LivingImage(new Uint8Array(10)), null);
  assert.equal(extractWin10LivingImage(new Uint8Array([0x00, 0x00])), null);

  // Valid JPEG but no embedded ZIP
  const regularJpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00, 0xFF, 0xD9]);
  assert.equal(extractWin10LivingImage(regularJpeg), null);

  assert.throws(() => convertWin10LivingImage(regularJpeg), {
    message: /Not a valid Windows 10 Living Image/
  });
});

test('extractWin10LivingImage correctly extracts and converts real Windows 10 Mobile Living Image', () => {
  const realSamplePath = 'G:\\OneDrive\\Bilder\\2016\\2016-01-23 Ehrwald\\WP_20160123_15_23_26_Pro_LI.jpg';
  if (!fs.existsSync(realSamplePath)) {
    // Skip if running in environment where sample path is not mounted
    return;
  }

  const rawBytes = fs.readFileSync(realSamplePath);
  const extracted = extractWin10LivingImage(rawBytes);

  assert.ok(extracted, 'Should successfully extract living image components');
  assert.equal(extracted.stillJpeg.length, 321742, 'Still JPEG length must match byte 321742');
  assert.equal(extracted.stillJpeg[0], 0xFF);
  assert.equal(extracted.stillJpeg[1], 0xD8);
  assert.equal(extracted.stillJpeg[extracted.stillJpeg.length - 2], 0xFF);
  assert.equal(extracted.stillJpeg[extracted.stillJpeg.length - 1], 0xD9);

  assert.equal(extracted.videoBytes.length, 1636888, 'Video stream length must match 1636888');
  const videoBoxType = new TextDecoder().decode(extracted.videoBytes.subarray(4, 8));
  assert.equal(videoBoxType, 'ftyp', 'Video must start with ftyp box');

  // Test full conversion to Android Motion Photo 1.0
  const motionPhoto = convertWin10LivingImage(rawBytes);
  assert.ok(motionPhoto.length > extracted.stillJpeg.length + extracted.videoBytes.length);
  assert.equal(motionPhoto[0], 0xFF);
  assert.equal(motionPhoto[1], 0xD8);

  const asString = new TextDecoder('latin1').decode(motionPhoto);
  assert.ok(asString.includes('<Camera:MotionPhoto>1</Camera:MotionPhoto>'));
  assert.ok(asString.includes('<GCamera:MicroVideoOffset>1636888</GCamera:MicroVideoOffset>'));
  assert.ok(asString.includes('<Container:Directory>'));

  // Trailing bytes must equal video stream
  const trailingBytes = motionPhoto.subarray(motionPhoto.length - extracted.videoBytes.length);
  assert.equal(Buffer.compare(trailingBytes, extracted.videoBytes), 0);
});

test('extractWin10LivingImage extracts shifted ZIP64 archives (e.g. metadata modified)', () => {
  const weddingSample = 'G:/OneDrive/Bilder/2016/2016-07-30 Robert & Stephanie Hochzeit/WP_20160730_12_20_27_Rich_LI.jpg';
  if (!fs.existsSync(weddingSample)) {
    return;
  }

  const rawBytes = fs.readFileSync(weddingSample);
  const extracted = extractWin10LivingImage(rawBytes);
  assert.ok(extracted, 'Should successfully extract from shifted ZIP64');
  assert.equal(extracted.videoBytes.length, 1043916);
  const boxType = new TextDecoder().decode(extracted.videoBytes.subarray(4, 8));
  assert.equal(boxType, 'ftyp', 'Must be valid MP4 starting with ftyp');

  const motionPhoto = convertWin10LivingImage(rawBytes);
  assert.ok(motionPhoto.length > extracted.stillJpeg.length + extracted.videoBytes.length);
  assert.equal(motionPhoto[0], 0xFF);
  assert.equal(motionPhoto[1], 0xD8);

  const asString = new TextDecoder('latin1').decode(motionPhoto);
  assert.ok(asString.includes('<Camera:MotionPhoto>1</Camera:MotionPhoto>'));
  assert.ok(asString.includes('<GCamera:MicroVideoOffset>1043916</GCamera:MicroVideoOffset>'));
});



