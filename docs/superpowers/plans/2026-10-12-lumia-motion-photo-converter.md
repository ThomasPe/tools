# Lumia Living Images to Google Motion Photo Web Converter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-dependency, standalone client-side web application (`converter.html`) that runs in Microsoft Edge/Chrome to transform legacy Windows Phone Living Images into Google Motion Photos (Android Motion Photo 1.0) and save them into a `converted_motion_photos/` subfolder.

**Architecture:** Pure vanilla JavaScript binary engine that parses JPEG markers, injects standardized XMP APP1 metadata (`Camera:MotionPhoto` and `Container:Directory`), and appends the `.mp4.thm` video stream directly after the JPEG End-of-Image marker (`FF D9`). Uses the browser File System Access API for folder selection and streaming writes.

**Tech Stack:** Vanilla HTML5, CSS3, ES6+ JavaScript (`Uint8Array`, `DataView`, `File`, `FileSystemDirectoryHandle`), Node.js built-in test runner (`node:test`, `node:assert`) for TDD verification.

## Global Constraints

- Standalone single-file deliverable (`converter.html`) requiring no external CDN libraries, node_modules, or server backend.
- Original files in the source directory must never be modified or deleted.
- Supports pairing `.mp4.thm` with both standard `_Pro.jpg` and full-resolution `__highres.jpg`.
- Conforms strictly to Android Motion Photo Format 1.0 specifications for full compatibility with Google Photos and Windows 11 Photos.

---

### Task 1: Core Binary Motion Photo Engine (`motion-photo-engine.js`)

**Files:**
- Create: `src/motion-photo-engine.js`
- Test: `test/test-engine.mjs`

**Interfaces:**
- Produces:
  - `createXmpPacket(videoLength: number): string`
  - `createApp1XmpSegment(xmpString: string): Uint8Array`
  - `spliceMotionPhoto(jpegBytes: Uint8Array, videoBytes: Uint8Array): Uint8Array`

- [ ] **Step 1: Write the failing tests for XMP and JPEG binary splicing**

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/test-engine.mjs`
Expected: FAIL with "Cannot find module '../src/motion-photo-engine.js'"

- [ ] **Step 3: Implement minimal binary engine**

```javascript
// src/motion-photo-engine.js

export function createXmpPacket(videoLength) {
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.1.0-jc003">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:Camera="http://ns.google.com/photos/1.0/camera/"
    xmlns:GCamera="http://ns.google.com/photos/1.0/camera/">
   <Camera:MotionPhoto>1</Camera:MotionPhoto>
   <Camera:MotionPhotoVersion>1</Camera:MotionPhotoVersion>
   <Camera:MotionPhotoPresentationTimestampUs>0</Camera:MotionPhotoPresentationTimestampUs>
   <GCamera:MicroVideo>1</GCamera:MicroVideo>
   <GCamera:MicroVideoVersion>1</GCamera:MicroVideoVersion>
   <GCamera:MicroVideoOffset>${videoLength}</GCamera:MicroVideoOffset>
   <GCamera:MicroVideoPresentationTimestampUs>0</GCamera:MicroVideoPresentationTimestampUs>
  </rdf:Description>
  <rdf:Description rdf:about=""
    xmlns:Container="http://ns.google.com/photos/1.0/container/"
    xmlns:Item="http://ns.google.com/photos/1.0/container/item/">
   <Container:Directory>
    <rdf:Seq>
     <rdf:li>
      <rdf:Description
        Item:Mime="image/jpeg"
        Item:Semantic="Primary"
        Item:Length="0"
        Item:Padding="0"/>
     </rdf:li>
     <rdf:li>
      <rdf:Description
        Item:Mime="video/mp4"
        Item:Semantic="MotionPhoto"
        Item:Length="${videoLength}"
        Item:Padding="0"/>
     </rdf:li>
    </rdf:Seq>
   </Container:Directory>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;
}

export function createApp1XmpSegment(xmpString) {
  const encoder = new TextEncoder();
  const xmpBytes = encoder.encode(xmpString);
  const xmpHeader = encoder.encode('http://ns.adobe.com/xap/1.0/\0'); // 29 bytes
  const payloadLength = xmpHeader.length + xmpBytes.length;
  const segmentLength = payloadLength + 2; // includes 2 bytes for length field

  const segment = new Uint8Array(2 + segmentLength);
  segment[0] = 0xFF;
  segment[1] = 0xE1;
  segment[2] = (segmentLength >> 8) & 0xFF;
  segment[3] = segmentLength & 0xFF;
  segment.set(xmpHeader, 4);
  segment.set(xmpBytes, 4 + xmpHeader.length);
  return segment;
}

export function spliceMotionPhoto(jpegBytes, videoBytes) {
  if (jpegBytes[0] !== 0xFF || jpegBytes[1] !== 0xD8) {
    throw new Error('Invalid JPEG: Missing SOI marker (FF D8)');
  }

  // Scan JPEG segments to find where to insert the XMP APP1 block
  // Ideally, insert right after EXIF APP1 (if present), or right after SOI (index 2)
  let insertPos = 2;
  let offset = 2;

  while (offset < jpegBytes.length - 4) {
    if (jpegBytes[offset] !== 0xFF) break;
    const marker = jpegBytes[offset + 1];
    if (marker === 0xD9 || marker === 0xDA) { // EOI or SOS (Start of Scan)
      break;
    }
    const segLength = (jpegBytes[offset + 2] << 8) | jpegBytes[offset + 3];
    // If it's an EXIF APP1 segment (FF E1 followed by 'Exif\0\0')
    if (marker === 0xE1 && offset + 10 <= jpegBytes.length) {
      const isExif = jpegBytes[offset + 4] === 0x45 && // E
                     jpegBytes[offset + 5] === 0x78 && // x
                     jpegBytes[offset + 6] === 0x69 && // i
                     jpegBytes[offset + 7] === 0x66 && // f
                     jpegBytes[offset + 8] === 0x00 &&
                     jpegBytes[offset + 9] === 0x00;
      if (isExif) {
        insertPos = offset + 2 + segLength;
      }
    }
    offset += 2 + segLength;
  }

  const xmpString = createXmpPacket(videoBytes.length);
  const app1Segment = createApp1XmpSegment(xmpString);

  // Locate the end of the JPEG (EOI: FF D9)
  let eoiPos = jpegBytes.length;
  for (let i = jpegBytes.length - 2; i >= 0; i--) {
    if (jpegBytes[i] === 0xFF && jpegBytes[i + 1] === 0xD9) {
      eoiPos = i + 2;
      break;
    }
  }

  // Total buffer length: jpeg prefix + new APP1 segment + jpeg rest + video bytes
  const totalLength = insertPos + app1Segment.length + (eoiPos - insertPos) + videoBytes.length;
  const result = new Uint8Array(totalLength);

  let writePos = 0;
  result.set(jpegBytes.subarray(0, insertPos), writePos);
  writePos += insertPos;

  result.set(app1Segment, writePos);
  writePos += app1Segment.length;

  result.set(jpegBytes.subarray(insertPos, eoiPos), writePos);
  writePos += (eoiPos - insertPos);

  result.set(videoBytes, writePos);

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/test-engine.mjs`
Expected: PASS all 3 tests.

---

### Task 2: Pairing & Scanner Module (`file-matcher.js`)

**Files:**
- Create: `src/file-matcher.js`
- Test: `test/test-matcher.mjs`

**Interfaces:**
- Produces:
  - `parseBaseName(filename: string): { base: string, isVideo: boolean, isHighRes: boolean, isStandardJpg: boolean } | null`
  - `matchMediaPairs(files: Array<{ name: string, handle?: any, file?: File }>): { pairs: Array<{ videoFile: any, targetPhotos: Array<{ photoFile: any, outName: string, isHighRes: boolean }> }>, orphans: Array<string> }`

- [ ] **Step 1: Write failing test for pair matching**

```javascript
// test/test-matcher.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBaseName, matchMediaPairs } from '../src/file-matcher.js';

test('parseBaseName classifies Lumia filenames accurately', () => {
  const v = parseBaseName('WP_20140914_20_27_44_Pro.mp4.thm');
  assert.equal(v.base, 'WP_20140914_20_27_44_Pro');
  assert.equal(v.isVideo, true);

  const std = parseBaseName('WP_20140914_20_27_44_Pro.jpg');
  assert.equal(std.base, 'WP_20140914_20_27_44_Pro');
  assert.equal(std.isStandardJpg, true);

  const hires = parseBaseName('WP_20140914_20_27_44_Pro__highres.jpg');
  assert.equal(hires.base, 'WP_20140914_20_27_44_Pro');
  assert.equal(hires.isHighRes, true);
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
  assert.equal(result.pairs[0].targetPhotos[1].outName, 'WP_20140914_20_27_44_Pro__highres.jpg');
  assert.ok(result.orphans.includes('WP_20140914_STANDALONE.jpg'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/test-matcher.mjs`
Expected: FAIL with "Cannot find module '../src/file-matcher.js'"

- [ ] **Step 3: Implement minimal matcher module**

```javascript
// src/file-matcher.js

export function parseBaseName(filename) {
  const lower = filename.toLowerCase();

  // Video snippet: e.g. WP_..._Pro.mp4.thm or WP_..._Pro.mp4
  if (lower.endsWith('.mp4.thm')) {
    const base = filename.slice(0, -'.mp4.thm'.length);
    return { base, isVideo: true, isHighRes: false, isStandardJpg: false };
  }
  if (lower.endsWith('.mp4') && !lower.includes('storyteller')) {
    const base = filename.slice(0, -'.mp4'.length);
    return { base, isVideo: true, isHighRes: false, isStandardJpg: false };
  }

  // High-res photo: e.g. WP_..._Pro__highres.jpg
  if (lower.endsWith('__highres.jpg') || lower.endsWith('__highres.jpeg')) {
    const ext = lower.endsWith('.jpeg') ? '.jpeg' : '.jpg';
    const base = filename.slice(0, -(ext.length + '__highres'.length));
    return { base, isVideo: false, isHighRes: true, isStandardJpg: false };
  }

  // Standard photo: e.g. WP_..._Pro.jpg
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    const ext = lower.endsWith('.jpeg') ? '.jpeg' : '.jpg';
    const base = filename.slice(0, -ext.length);
    return { base, isVideo: false, isHighRes: false, isStandardJpg: true };
  }

  return null;
}

export function matchMediaPairs(files) {
  const videosByBase = new Map();
  const stdPhotosByBase = new Map();
  const highResPhotosByBase = new Map();
  const allNames = new Set(files.map(f => f.name));

  for (const item of files) {
    const info = parseBaseName(item.name);
    if (!info) continue;
    if (info.isVideo) {
      videosByBase.set(info.base, item);
    } else if (info.isHighRes) {
      highResPhotosByBase.set(info.base, item);
    } else if (info.isStandardJpg) {
      stdPhotosByBase.set(info.base, item);
    }
  }

  const pairs = [];
  const matchedPhotos = new Set();

  for (const [base, videoItem] of videosByBase.entries()) {
    const targetPhotos = [];
    const stdPhoto = stdPhotosByBase.get(base);
    if (stdPhoto) {
      targetPhotos.push({
        photoFile: stdPhoto,
        outName: stdPhoto.name,
        isHighRes: false
      });
      matchedPhotos.add(stdPhoto.name);
    }

    const highResPhoto = highResPhotosByBase.get(base);
    if (highResPhoto) {
      targetPhotos.push({
        photoFile: highResPhoto,
        outName: highResPhoto.name,
        isHighRes: true
      });
      matchedPhotos.add(highResPhoto.name);
    }

    if (targetPhotos.length > 0) {
      pairs.push({
        videoFile: videoItem,
        targetPhotos
      });
    }
  }

  const orphans = [];
  for (const name of allNames) {
    const info = parseBaseName(name);
    if (info && !info.isVideo && !matchedPhotos.has(name)) {
      orphans.push(name);
    }
  }

  return { pairs, orphans };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/test-matcher.mjs`
Expected: PASS all 2 tests.

---

### Task 3: Build the Standalone Web App (`converter.html`)

**Files:**
- Create: `converter.html`

**Interfaces:**
- Self-contained UI integrating `spliceMotionPhoto`, `matchMediaPairs`, and File System Access API.

- [ ] **Step 1: Create `converter.html` with clean responsive UI and embedded tested modules**

Include:
- Gradient card layout with header ("Lumia Living Images -> Motion Photos").
- Feature badges: "100% Client-Side", "Android Motion Photo 1.0", "Google Pixel & Windows 11 Compatible".
- Action controls: "Select Folder" button (`showDirectoryPicker`), drag-and-drop zone.
- Real-time statistics: Total Files, Detected Pairs, Converted Files, Output folder status.
- Progress bar and colored log console.
- In-place streaming conversion: converts pair-by-pair and streams directly into `converted_motion_photos/`.

- [ ] **Step 2: Add Drag & Drop fallback with ZIP or direct download capability**
Ensure that even if a browser blocks `showDirectoryPicker`, the user can drag their files into the browser and download converted files.

---

### Task 4: Real-Data Verification & Live Test

**Files:**
- Test with: `WP_20140914_20_27_44_Pro.jpg` and `WP_20140914_20_27_44_Pro.mp4.thm`
- Create test runner: `test/test-real-conversion.mjs`

- [ ] **Step 1: Write integration test converting a real pair from the folder**
- [ ] **Step 2: Verify binary properties of generated file:**
  - Verify file size == (original JPEG size + video size + APP1 XMP size).
  - Verify XMP tags match `Camera:MotionPhoto="1"`, `Item:Semantic="MotionPhoto"`, `Item:Length`.
  - Verify trailing bytes match MP4 box (`ftyp`).
- [ ] **Step 3: Test opening `converter.html` and verify UI**
