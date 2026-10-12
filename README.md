# In-Browser Web Tools (`tools.pentenrieder.dev`)

[![Deploy to GitHub Pages](https://github.com/ThomasPe/tools/actions/workflows/deploy.yml/badge.svg)](https://github.com/ThomasPe/tools/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-brightgreen.svg)]()
[![100% Client-Side](https://img.shields.io/badge/Privacy-100%25%20Client--Side-success.svg)]()

> A curated collection of fast, private, 100% client-side web utilities by [Thomas Pentenrieder](https://pentenrieder.dev). Everything runs entirely in your local browser sandbox &mdash; zero servers, zero uploads, zero tracking.

🌐 **Live Hub:** **[https://tools.pentenrieder.dev](https://tools.pentenrieder.dev)**

---

## 🛠️ Included Tools

### 1. Lumia Living Images &rarr; Google Motion Photos Converter
* **URL:** [https://tools.pentenrieder.dev/lumia-motion-photo-converter/](https://tools.pentenrieder.dev/lumia-motion-photo-converter/)
* **Directory:** [`lumia-motion-photo-converter/`](lumia-motion-photo-converter/)
* **Description:** Transforms legacy Windows Phone / Nokia Lumia "Living Images" (`.jpg` + `.mp4.thm`) into modern **Android Motion Photo 1.0** single-file images &mdash; fully compatible with **Google Pixel, Google Photos, Samsung Gallery, and Windows 11 Photos**.
* **Key Capabilities:**
  * Slices and injects standardized XMP APP1 container metadata (`Camera:MotionPhoto` and `Container:Directory`).
  * Appends the trailing video stream after the JPEG `FF D9` marker.
  * Preserves 100% camera EXIF data byte-for-byte.
  * Pairs both 5MP oversampled (`_Pro.jpg`) and PureView sensor (`__highres.jpg`) versions.
  * Leverages File System Access API (`showDirectoryPicker`) for direct folder-to-folder streaming.

---

## 📁 Repository Structure

```text
tools/
├── CNAME                              # Custom domain (tools.pentenrieder.dev)
├── index.html                         # Tools Hub portal homepage
├── lumia-motion-photo-converter/      # Tool 1: Lumia converter web app
│   └── index.html
├── src/                               # Shared / modular engine logic
│   ├── motion-photo-engine.js
│   └── file-matcher.js
├── test/                              # Automated test suites (Node.js test runner)
│   ├── test-engine.mjs
│   ├── test-matcher.mjs
│   └── test-html.mjs
├── .github/workflows/
│   └── deploy.yml                     # GitHub Actions CI & Pages deployment
├── package.json
└── README.md
```

---

## 🧪 Local Testing

All unit tests run natively with zero dependencies:

```bash
npm test
```

Tests run against Node's built-in test runner (`node:test`) and complete in < 150ms.

---

## 📄 License

[MIT](LICENSE) &copy; 2026 Thomas Pentenrieder
