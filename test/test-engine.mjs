// test/test-engine.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createXmpPacket, createApp1XmpSegment, spliceMotionPhoto } from '../src/motion-photo-engine.js';

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

