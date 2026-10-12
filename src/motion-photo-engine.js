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
