# Lumia Living Images &rarr; Google Motion Photos Converter

[![Deploy to GitHub Pages](https://github.com/ThomasPe/lumia-motion-photo-converter/actions/workflows/deploy.yml/badge.svg)](https://github.com/ThomasPe/lumia-motion-photo-converter/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-brightgreen.svg)]()
[![100% Client-Side](https://img.shields.io/badge/Privacy-100%25%20Client--Side-success.svg)]()

> A standalone, privacy-first, 100% client-side web application to transform legacy **Windows Phone / Nokia Lumia "Living Images"** (`.jpg` + `.mp4.thm`) into modern **Android Motion Photo 1.0** files — fully compatible with **Google Pixel, Google Photos, Samsung Gallery, and Windows 11 Photos**.

🚀 **Live App:** [https://thomaspe.github.io/lumia-motion-photo-converter/](https://thomaspe.github.io/lumia-motion-photo-converter/)

---

## 📸 The Problem

Back in 2014, Nokia Lumia phones running Windows Phone 8.1 (such as the Lumia 930, 1020, and 1520) pioneered "Living Images" — capturing a short video clip right before you snapped a photo.

Nokia stored these as **separate paired files** on disk:
* Standard 5MP oversampled photo: `WP_YYYYMMDD_HH_MM_SS_Pro.jpg`
* PureView high-resolution sensor photo: `WP_YYYYMMDD_HH_MM_SS_Pro__highres.jpg`
* Living image video snippet: `WP_YYYYMMDD_HH_MM_SS_Pro.mp4.thm`

The `.mp4.thm` file was given a thumbnail (`.thm`) extension so the Windows Phone camera roll wouldn't be flooded with separate video clips, but it is actually a standard H.264/AAC MP4 video stream.

Modern platforms (like Google Pixel, Samsung Galaxy, and the modern Windows 11 Photos app) bundle motion photos into a **single file**: the still image contains the short video clip appended to the end, accompanied by standardized XMP container metadata.

Without conversion, modern viewers treat your old Lumia photos as ordinary static pictures, leaving the `.mp4.thm` video clips stranded and unplayed.

---

## ✨ Features

* **🔒 100% Client-Side & Private:** Everything runs directly inside your browser. Your personal family photos and videos **never leave your device**.
* **⚡ Blazing Fast:** No video transcoding or re-encoding is needed (the Lumia `.thm` is already a valid MP4). The tool performs pure binary splicing in RAM, converting 100+ photos in **under 3 seconds**.
* **🎯 Dual-Resolution PureView Support:** Automatically pairs the single video snippet with **both** the standard 5MP photo (`_Pro.jpg`) and the full-resolution sensor photo (`__highres.jpg`), creating motion photos for both versions.
* **🛡️ Original EXIF Preservation:** Preserves all original camera EXIF metadata byte-for-byte (camera sensor settings, exposure, timestamps, GPS coordinates, orientation).
* **🌐 Universal Motion Photo Standards:**
  * **Android Motion Photo Format 1.0:** Conforms to the official specification using `Container:Directory` with `Item:Semantic="MotionPhoto"` and exact byte lengths.
  * **Legacy Google Camera MicroVideo:** Injects `Camera:MotionPhoto="1"` and `GCamera:MicroVideoOffset` for maximum backwards compatibility.
* **📂 Native Folder-to-Folder Streaming:** Uses the browser **File System Access API** (`showDirectoryPicker`) to read from your photo directory and write converted files directly into a new `converted_motion_photos/` subfolder.
* **🗂️ Drag & Drop Fallback:** Drag entire folders or files directly into the window, with automatic individual or bulk downloads.
* **📦 Zero Dependencies:** No Node modules, no external scripts, no CDNs, no tracking. Works completely offline.

---

## 🛠️ How It Works

```text
[ Input: Lumia Folder ]
  ├── WP_..._Pro.jpg              (Standard 5MP photo)
  ├── WP_..._Pro__highres.jpg     (PureView full-res photo)
  └── WP_..._Pro.mp4.thm          (Standard H.264 MP4 video clip)
                 │
                 ▼
 1. Match Pairs by base filename stem
 2. Verify JPEG markers (SOI FF D8, locate existing EXIF APP1)
 3. Construct Adobe XMP packet (Android Motion Photo 1.0 + GCamera namespaces)
 4. Insert XMP APP1 segment (FF E1) right after existing EXIF block
 5. Verify JPEG End-Of-Image marker (EOI FF D9)
 6. Binary Append: attach raw MP4 stream directly after FF D9
                 │
                 ▼
[ Output: converted_motion_photos/ ]
  ├── WP_..._Pro.jpg              (Single-file Google Motion Photo)
  └── WP_..._Pro__highres.jpg     (Single-file Google Motion Photo)
```

Standard image viewers read up to the `FF D9` marker and display the photo normally. Compatible viewers (Google Photos, Pixel, Windows 11 Photos) detect the XMP container tags, jump to the video offset, and show the interactive **"Motion" play button**.

---

## 🚀 Usage

### Option 1: Use the Online Web App
Open the deployed app in **Google Chrome** or **Microsoft Edge**:
👉 **[https://thomaspe.github.io/lumia-motion-photo-converter/](https://thomaspe.github.io/lumia-motion-photo-converter/)**

1. Click **"Select Photo Folder"** and select your folder.
2. Review the detected pairs.
3. Click **"Convert to Motion Photos"**.
4. The converted files are saved to `converted_motion_photos/` inside that folder.

### Option 2: Run Offline Locally
Clone this repository and double-click `index.html` (or `converter.html`):
```bash
git clone https://github.com/ThomasPe/lumia-motion-photo-converter.git
cd lumia-motion-photo-converter
# Open index.html in Edge or Chrome
```
No web server or build process is required!

---

## 🧪 Local Testing

Unit tests run natively via Node.js:

```bash
npm test
```

All 11 automated test suites execute in < 150ms:
* `test/test-engine.mjs`: Tests XMP generation, APP1 marker creation, EXIF preservation, and binary splicing.
* `test/test-matcher.mjs`: Tests Lumia filename parsing, dual-resolution pair matching, and orphan detection.
* `test/test-html.mjs`: Verifies `index.html` and `converter.html` integrity, DOM synchronization, and zero-network isolation.

---

## 📄 License

[MIT](LICENSE) &copy; 2026 ThomasPe
