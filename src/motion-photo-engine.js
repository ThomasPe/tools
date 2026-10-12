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
  let eoiPos = -1;
  for (let i = jpegBytes.length - 2; i >= 0; i--) {
    if (jpegBytes[i] === 0xFF && jpegBytes[i + 1] === 0xD9) {
      eoiPos = i + 2;
      break;
    }
  }
  if (eoiPos === -1) {
    throw new Error('Invalid JPEG: Missing EOI marker (FF D9)');
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

/**
 * Extracts the primary still JPEG and embedded living video stream from a
 * Windows 10 Mobile Living Image (*_LI.jpg).
 *
 * Windows 10 Mobile appends an uncompressed ZIP archive after the primary JPEG's
 * EOI marker (FF D9). The ZIP contains `formats/living/living.mp4` stored with
 * compression method 0 (Stored / uncompressed).
 *
 * @param {Uint8Array} jpegBytes Raw binary buffer of the JPEG file.
 * @returns {{ stillJpeg: Uint8Array, videoBytes: Uint8Array } | null} Extracted components, or null if not a Win10 Living Image.
 */
export function extractWin10LivingImage(jpegBytes) {
  if (!jpegBytes || jpegBytes.length < 100) return null;
  if (jpegBytes[0] !== 0xFF || jpegBytes[1] !== 0xD8) return null;

  const len = jpegBytes.length;

  // 1. Find ZIP EOCD marker (PK\x05\x06) searching backwards from the end
  let eocdOffset = -1;
  const minScan = Math.max(0, len - 65557);
  for (let i = len - 22; i >= minScan; i--) {
    if (jpegBytes[i] === 0x50 && jpegBytes[i+1] === 0x4B && jpegBytes[i+2] === 0x05 && jpegBytes[i+3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return null;

  const eocdView = new DataView(jpegBytes.buffer, jpegBytes.byteOffset + eocdOffset, 22);
  let cdEntries = eocdView.getUint16(10, true);
  let cdSize = eocdView.getUint32(12, true);
  let cdOffset = eocdView.getUint32(16, true);
  let delta = 0;

  // 2. Check for ZIP64 Locator (PK\x06\x07) 20 bytes preceding EOCD
  if (eocdOffset >= 20 &&
      jpegBytes[eocdOffset - 20] === 0x50 &&
      jpegBytes[eocdOffset - 19] === 0x4B &&
      jpegBytes[eocdOffset - 18] === 0x06 &&
      jpegBytes[eocdOffset - 17] === 0x07) {
    const locView = new DataView(jpegBytes.buffer, jpegBytes.byteOffset + eocdOffset - 20, 20);
    const locZip64EocdPos = Number(locView.getBigUint64(8, true));

    // Check if ZIP64 EOCD is at the recorded offset OR directly adjacent (eocdOffset - 76)
    let actualZip64Pos = -1;
    if (locZip64EocdPos + 56 <= len &&
        jpegBytes[locZip64EocdPos] === 0x50 &&
        jpegBytes[locZip64EocdPos + 1] === 0x4B &&
        jpegBytes[locZip64EocdPos + 2] === 0x06 &&
        jpegBytes[locZip64EocdPos + 3] === 0x06) {
      actualZip64Pos = locZip64EocdPos;
      delta = 0;
    } else if (eocdOffset >= 76 &&
               jpegBytes[eocdOffset - 76] === 0x50 &&
               jpegBytes[eocdOffset - 75] === 0x4B &&
               jpegBytes[eocdOffset - 74] === 0x06 &&
               jpegBytes[eocdOffset - 73] === 0x06) {
      actualZip64Pos = eocdOffset - 76;
      delta = actualZip64Pos - locZip64EocdPos;
    }

    if (actualZip64Pos !== -1) {
      const z64View = new DataView(jpegBytes.buffer, jpegBytes.byteOffset + actualZip64Pos, 56);
      cdEntries = Number(z64View.getBigUint64(32, true));
      cdSize = Number(z64View.getBigUint64(40, true));
      cdOffset = Number(z64View.getBigUint64(48, true));
    }
  }

  // 3. Resolve Central Directory start position (handles absolute vs relative polyglot offsets and shifted ZIPs)
  let cdStart = cdOffset + delta;
  let isCdValid = (cdStart + 4 <= len &&
                   jpegBytes[cdStart] === 0x50 &&
                   jpegBytes[cdStart + 1] === 0x4B &&
                   jpegBytes[cdStart + 2] === 0x01 &&
                   jpegBytes[cdStart + 3] === 0x02);

  let zipStartOffset = delta;
  if (!isCdValid) {
    const calcZipStart = eocdOffset - cdSize - cdOffset;
    if (calcZipStart >= 0 &&
        calcZipStart + cdOffset + 4 <= len &&
        jpegBytes[calcZipStart + cdOffset] === 0x50 &&
        jpegBytes[calcZipStart + cdOffset + 1] === 0x4B &&
        jpegBytes[calcZipStart + cdOffset + 2] === 0x01 &&
        jpegBytes[calcZipStart + cdOffset + 3] === 0x02) {
      cdStart = calcZipStart + cdOffset;
      zipStartOffset = calcZipStart;
      isCdValid = true;
    }
  }

  if (!isCdValid) return null;

  // 4. Scan Central Directory to find living.mp4
  let cdPos = cdStart;
  let targetEntry = null;
  let firstLocalOffset = Infinity;

  const decoder = new TextDecoder();
  for (let c = 0; c < cdEntries; c++) {
    if (cdPos + 46 > len) break;
    if (jpegBytes[cdPos] !== 0x50 || jpegBytes[cdPos+1] !== 0x4B || jpegBytes[cdPos+2] !== 0x01 || jpegBytes[cdPos+3] !== 0x02) {
      break;
    }

    const cdView = new DataView(jpegBytes.buffer, jpegBytes.byteOffset + cdPos, 46);
    let compMethod = cdView.getUint16(10, true);
    let compSize = cdView.getUint32(20, true);
    let uncompSize = cdView.getUint32(24, true);
    let fnLen = cdView.getUint16(28, true);
    let extraLen = cdView.getUint16(30, true);
    let commentLen = cdView.getUint16(32, true);
    let localOffset = cdView.getUint32(42, true);

    const fn = decoder.decode(jpegBytes.subarray(cdPos + 46, cdPos + 46 + fnLen));

    // Check for ZIP64 extra fields (Tag 0x0001)
    let extraPos = cdPos + 46 + fnLen;
    const extraEnd = extraPos + extraLen;
    while (extraPos + 4 <= extraEnd) {
      const extraView = new DataView(jpegBytes.buffer, jpegBytes.byteOffset + extraPos, 4);
      const tag = extraView.getUint16(0, true);
      const tagSize = extraView.getUint16(2, true);
      let tagDataPos = extraPos + 4;
      if (tag === 0x0001) {
        if (uncompSize === 0xFFFFFFFF && tagDataPos + 8 <= extraEnd) {
          uncompSize = Number(new DataView(jpegBytes.buffer, jpegBytes.byteOffset + tagDataPos, 8).getBigUint64(0, true));
          tagDataPos += 8;
        }
        if (compSize === 0xFFFFFFFF && tagDataPos + 8 <= extraEnd) {
          compSize = Number(new DataView(jpegBytes.buffer, jpegBytes.byteOffset + tagDataPos, 8).getBigUint64(0, true));
          tagDataPos += 8;
        }
        if (localOffset === 0xFFFFFFFF && tagDataPos + 8 <= extraEnd) {
          localOffset = Number(new DataView(jpegBytes.buffer, jpegBytes.byteOffset + tagDataPos, 8).getBigUint64(0, true));
          tagDataPos += 8;
        }
      }
      extraPos += 4 + tagSize;
    }

    // Resolve local header offset (check absolute with delta vs relative)
    let absLocalOffset = localOffset + delta;
    if (!(absLocalOffset + 4 <= len &&
          jpegBytes[absLocalOffset] === 0x50 &&
          jpegBytes[absLocalOffset+1] === 0x4B &&
          jpegBytes[absLocalOffset+2] === 0x03 &&
          jpegBytes[absLocalOffset+3] === 0x04)) {
      if (zipStartOffset + localOffset + 4 <= len &&
          jpegBytes[zipStartOffset + localOffset] === 0x50 &&
          jpegBytes[zipStartOffset + localOffset+1] === 0x4B &&
          jpegBytes[zipStartOffset + localOffset+2] === 0x03 &&
          jpegBytes[zipStartOffset + localOffset+3] === 0x04) {
        absLocalOffset = zipStartOffset + localOffset;
      }
    }

    if (absLocalOffset < firstLocalOffset) {
      firstLocalOffset = absLocalOffset;
    }

    const lowerFn = fn.toLowerCase();
    if (lowerFn.endsWith('living.mp4') || (!targetEntry && lowerFn.endsWith('.mp4'))) {
      targetEntry = {
        name: fn,
        compMethod,
        compSize,
        uncompSize,
        absLocalOffset
      };
    }

    cdPos += 46 + fnLen + extraLen + commentLen;
  }

  if (!targetEntry || targetEntry.compMethod !== 0 || targetEntry.compSize === 0) {
    return null;
  }

  // 5. Read Local File Header for the video entry
  const lhOffset = targetEntry.absLocalOffset;
  if (lhOffset + 30 > len ||
      jpegBytes[lhOffset] !== 0x50 ||
      jpegBytes[lhOffset + 1] !== 0x4B ||
      jpegBytes[lhOffset + 2] !== 0x03 ||
      jpegBytes[lhOffset + 3] !== 0x04) {
    return null;
  }

  const lhView = new DataView(jpegBytes.buffer, jpegBytes.byteOffset + lhOffset, 30);
  const lhFnLen = lhView.getUint16(26, true);
  const lhExtraLen = lhView.getUint16(28, true);
  const videoDataStart = lhOffset + 30 + lhFnLen + lhExtraLen;
  const videoDataEnd = videoDataStart + targetEntry.compSize;

  if (videoDataEnd > len) return null;

  const videoBytes = jpegBytes.subarray(videoDataStart, videoDataEnd);

  // Validate that video begins with standard MP4 box (ftyp, moov, or mdat)
  if (videoBytes.length < 8) return null;
  const boxType = decoder.decode(videoBytes.subarray(4, 8));
  if (boxType !== 'ftyp' && boxType !== 'moov' && boxType !== 'mdat') {
    return null;
  }

  // 6. Locate Still JPEG boundary (ends at EOI before the first ZIP entry)
  let eoiPos = -1;
  const scanLimit = (firstLocalOffset !== Infinity && firstLocalOffset < len) ? firstLocalOffset : len;
  for (let i = scanLimit - 2; i >= 0; i--) {
    if (jpegBytes[i] === 0xFF && jpegBytes[i+1] === 0xD9) {
      eoiPos = i + 2;
      break;
    }
  }

  if (eoiPos === -1) return null;

  const stillJpeg = jpegBytes.subarray(0, eoiPos);

  return { stillJpeg, videoBytes };
}

/**
 * Converts a Windows 10 Mobile Living Image into a standard Android Motion Photo 1.0.
 *
 * @param {Uint8Array} jpegBytes
 * @returns {Uint8Array} Converted Motion Photo binary buffer.
 */
export function convertWin10LivingImage(jpegBytes) {
  const extracted = extractWin10LivingImage(jpegBytes);
  if (!extracted) {
    throw new Error('Not a valid Windows 10 Living Image: missing or unparseable embedded motion video');
  }
  return spliceMotionPhoto(extracted.stillJpeg, extracted.videoBytes);
}

