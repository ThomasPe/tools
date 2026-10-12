// src/file-matcher.js

/**
 * Parses a filename to identify its base stem and role in Lumia Living Images.
 *
 * @param {string} filename
 * @returns {{ base: string, isVideo: boolean, isHighRes: boolean, isStandardJpg: boolean } | null}
 */
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

/**
 * Scans a list of file entries (with `name` property) and matches video snippets
 * with their corresponding standard and/or high-resolution photos.
 *
 * @param {Array<{ name: string, handle?: any, file?: File }>} files
 * @returns {{
 *   pairs: Array<{
 *     videoFile: any,
 *     targetPhotos: Array<{ photoFile: any, outName: string, isHighRes: boolean }>
 *   }>,
 *   orphans: Array<string>
 * }}
 */
export function matchMediaPairs(files) {
  const videosByBase = new Map();
  const stdPhotosByBase = new Map();
  const highResPhotosByBase = new Map();
  const allNames = new Set(files.map(f => f.name));

  for (const item of files) {
    const info = parseBaseName(item.name);
    if (!info) continue;
    if (info.isVideo) {
      const existing = videosByBase.get(info.base);
      if (!existing || (!existing.name.toLowerCase().endsWith('.mp4.thm') && item.name.toLowerCase().endsWith('.mp4.thm'))) {
        videosByBase.set(info.base, item);
      }
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
