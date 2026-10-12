# Lumia Living Images to Google Motion Photo Web Converter: Design Specification

## 1. Overview & Context

This design outlines a standalone, serverless, 100% client-side web application (`converter.html`) to transform legacy Windows Phone / Nokia Lumia "Living Images" into modern **Android Motion Photo 1.0** files (fully compatible with Google Pixel, Google Photos, Samsung Gallery, and Windows 11 Photos).

In Windows Phone 8.1 / Lumia Camera (e.g. from 2014), Living Images were stored as separate files:
- Standard 5MP oversampled photo: `WP_YYYYMMDD_HH_MM_SS_Pro.jpg`
- High-resolution PureView sensor photo: `WP_YYYYMMDD_HH_MM_SS_Pro__highres.jpg`
- Living image video snippet: `WP_YYYYMMDD_HH_MM_SS_Pro.mp4.thm` (a standard H.264/AAC MP4 video file with a `.thm` thumbnail extension)

Modern platforms (such as the Google Pixel and Windows 11 Photos app) bundle motion photos as a single file: a standard JPEG followed immediately by the MP4 video binary, coupled with XMP container metadata in the JPEG `APP1` segment.

The goal is to provide a zero-install, single-file browser tool that allows the user to select their photo folder, pair the images and videos, and produce standard Motion Photos directly on their local machine.

---

## 2. Architecture & Tech Stack

- **Delivery:** Single self-contained file (`converter.html`) containing HTML5, modern CSS3, and vanilla ES6+ JavaScript.
- **Runtime:** Runs entirely inside the local browser sandbox (tested for Microsoft Edge and Google Chrome on Windows 11).
- **Network Requirements:** Zero external dependencies, no CDN links, zero backend servers, completely offline capable.
- **I/O Integration:**
  - Modern File System Access API (`window.showDirectoryPicker()`): allows native directory browsing and direct file writing to disk into a newly created `converted_motion_photos/` subfolder.
  - Drag-and-drop / file input fallback for environments without directory picker support.

---

## 3. Pairing Logic & Mapping Rules

Given a folder containing mixed assets, the tool extracts the canonical base key for each video snippet:

1. **Video Detection:** Files ending with `.mp4.thm` or `[Base].mp4` where a matching `[Base].jpg` exists.
   - Example snippet: `WP_20140914_20_27_44_Pro.mp4.thm` -> Base key: `WP_20140914_20_27_44_Pro`.
2. **Photo Matching:**
   - Standard photo match: `WP_20140914_20_27_44_Pro.jpg`
   - High-res photo match: `WP_20140914_20_27_44_Pro__highres.jpg`
3. **Generation Strategy:**
   - Both versions are processed independently if present:
     - `converted_motion_photos/WP_20140914_20_27_44_Pro.jpg`
     - `converted_motion_photos/WP_20140914_20_27_44_Pro__highres.jpg`
   - Both output files contain the complete high-resolution still image and the embedded video clip.
4. **Standalone Media:**
   - Photos without matching `.mp4.thm` files are reported as static photos (and optionally copied through).
   - Full videos (e.g. `RUST_..._storyteller_...mp4`) are ignored from motion merging.

---

## 4. Binary Assembly & Metadata Specification

### 4.1 XMP Metadata Packet Construction
The tool constructs an Adobe XMP packet implementing both the official **Android Motion Photo 1.0** specification and the legacy **GCamera MicroVideo** specification for universal compatibility:

```xml
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.1.0-jc003">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:Camera="http://ns.google.com/photos/1.0/camera/"
    xmlns:GCamera="http://ns.google.com/photos/1.0/camera/">
   <Camera:MotionPhoto>1</Camera:MotionPhoto>
   <Camera:MotionPhotoVersion>1</Camera:MotionPhotoVersion>
   <Camera:MotionPhotoPresentationTimestampUs>0</Camera:MotionPhotoPresentationTimestampUs>
   <GCamera:MicroVideo>1</GCamera:MicroVideo>
   <GCamera:MicroVideoVersion>1</GCamera:MicroVideoVersion>
   <GCamera:MicroVideoOffset>VIDEO_LENGTH_BYTES</GCamera:MicroVideoOffset>
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
        Item:Length="VIDEO_LENGTH_BYTES"
        Item:Padding="0"/>
     </rdf:li>
    </rdf:Seq>
   </Container:Directory>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
```

### 4.2 JPEG Segment Injection
1. Verify JPEG starts with `0xFF, 0xD8` (SOI).
2. Scan existing markers:
   - Preserve existing EXIF `APP1` markers (`0xFF, 0xE1` with header `Exif\0\0`) to maintain timestamps, camera orientation, and sensor exposure settings.
   - Insert the new XMP `APP1` segment directly after the EXIF block (or after SOI if no EXIF block exists).
3. The XMP segment begins with `0xFF, 0xE1`, followed by 2-byte big-endian length (`length + 2 + 29`), followed by header `http://ns.adobe.com/xap/1.0/\0` (29 bytes), followed by the UTF-8 encoded XMP payload.
4. Locate the End-Of-Image marker `0xFF, 0xD9`.
5. Append the exact raw byte array of the `.mp4.thm` video immediately after `0xFF, 0xD9`.

---

## 5. User Interface & State Flow

1. **Dashboard:**
   - Modern, clean layout with dark/light mode aesthetics.
   - "Select Photo Folder" button (calling `showDirectoryPicker()`).
2. **Scan Status Card:**
   - Displays found statistics: total photos, video snippets, and detected pairs (Standard & High-Res).
   - "Convert to Motion Photos" button.
3. **Execution & Progress:**
   - Dynamic progress bar with percentage and counter (`Processing X of Y`).
   - Real-time scrollable activity log detailing processed pairs and sizes.
4. **Summary & Verification:**
   - Success banner upon completion with link/reference to `converted_motion_photos/`.

---

## 6. Error Handling & Edge Cases

- **Memory Limits:** Files are processed sequentially: read pair -> splice in memory -> stream write to destination handle -> release buffers. Browser garbage collection keeps memory usage flat regardless of album size.
- **Corrupt Inputs:**
  - JPEGs missing `FF D8` / `FF D9` are skipped with a logged warning.
  - Videos missing `ftyp` box are logged and skipped.
- **Non-Destructive Guarantee:** Original files are never modified, overwritten, or deleted.

---

## 7. Verification Plan

1. Generate a sample motion photo using a test pair from the current directory:
   - `WP_20140914_20_27_44_Pro.jpg` + `WP_20140914_20_27_44_Pro.mp4.thm`
2. Binary inspection: Verify XMP headers and trailer video offsets.
3. Functional verification: Open generated photo in Windows 11 Photos app to confirm the **"Motion" play button** appears and plays the embedded snippet.
