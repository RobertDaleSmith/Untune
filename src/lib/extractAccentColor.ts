/**
 * Adjust an RGB accent color for adequate contrast on a dark or light background.
 * Dark mode: clamp lightness to 55–75%, ensure saturation >= 40%.
 * Light mode: clamp lightness to 30–50%, ensure saturation >= 40%.
 * Returns a CSS-ready string like "rgb(96 165 250)".
 */
export function adjustForTheme(
  rgb: [number, number, number],
  isDark: boolean,
): string {
  // RGB → HSL
  const rn = rgb[0] / 255,
    gn = rgb[1] / 255,
    bn = rgb[2] / 255;
  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / d + 6) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }

  // Clamp saturation and lightness
  const minSat = 0.4;
  const adjS = Math.max(s, minSat);
  let adjL: number;
  if (isDark) {
    adjL = Math.max(0.55, Math.min(0.75, l));
  } else {
    adjL = Math.max(0.30, Math.min(0.50, l));
  }

  // HSL → RGB
  const c = (1 - Math.abs(2 * adjL - 1)) * adjS;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = adjL - c / 2;
  let r1 = 0,
    g1 = 0,
    b1 = 0;
  if (h < 60) { r1 = c; g1 = x; }
  else if (h < 120) { r1 = x; g1 = c; }
  else if (h < 180) { g1 = c; b1 = x; }
  else if (h < 240) { g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }

  const ro = Math.round((r1 + m) * 255);
  const go = Math.round((g1 + m) * 255);
  const bo = Math.round((b1 + m) * 255);
  return `rgb(${ro} ${go} ${bo})`;
}

// Cache extracted colors by data URL. Decoding the full-size album art into
// an offscreen Image() takes hundreds of ms — caching makes repeat tracks
// (same album, replayed songs) instant.
const accentCache = new Map<string, [number, number, number] | null>();

/**
 * Extract a vibrant accent color from an image using saturation-weighted hue bucketing.
 * Returns [r, g, b] or null if no vibrant color can be determined.
 */
export function extractAccentColor(
  imgSrc: string,
): Promise<[number, number, number] | null> {
  if (accentCache.has(imgSrc)) {
    return Promise.resolve(accentCache.get(imgSrc) ?? null);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      const cx = c.getContext("2d");
      if (!cx) {
        resolve(null);
        return;
      }
      cx.drawImage(img, 0, 0, 64, 64);
      const data = cx.getImageData(0, 0, 64, 64).data;

      // Bucket pixels by hue (12 buckets x 30deg), score by saturation squared.
      const NUM_BUCKETS = 12;
      const buckets: {
        rSum: number;
        gSum: number;
        bSum: number;
        satScore: number;
        count: number;
      }[] = Array.from({ length: NUM_BUCKETS }, () => ({
        rSum: 0,
        gSum: 0,
        bSum: 0,
        satScore: 0,
        count: 0,
      }));

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i],
          g = data[i + 1],
          b = data[i + 2];
        const rn = r / 255,
          gn = g / 255,
          bn = b / 255;
        const max = Math.max(rn, gn, bn),
          min = Math.min(rn, gn, bn);
        const l = (max + min) / 2;
        const d = max - min;
        // Skip near-black, near-white, and very desaturated pixels
        if (l < 0.1 || l > 0.9 || d < 0.08) continue;
        const s = d / (1 - Math.abs(2 * l - 1));
        let h = 0;
        if (d > 0) {
          if (max === rn) h = ((gn - bn) / d + 6) % 6;
          else if (max === gn) h = (bn - rn) / d + 2;
          else h = (rn - gn) / d + 4;
          h *= 60;
        }
        const bucketIdx = Math.min(NUM_BUCKETS - 1, Math.floor(h / 30));
        const bk = buckets[bucketIdx];
        // Weight by saturation squared — strongly prefer vivid colors
        const weight = s * s;
        bk.rSum += r * weight;
        bk.gSum += g * weight;
        bk.bSum += b * weight;
        bk.satScore += weight;
        bk.count++;
      }

      // Pick the bucket with highest total saturation score
      let best = -1,
        bestScore = 0;
      for (let i = 0; i < NUM_BUCKETS; i++) {
        if (buckets[i].satScore > bestScore) {
          bestScore = buckets[i].satScore;
          best = i;
        }
      }
      let result: [number, number, number] | null = null;
      if (best >= 0 && bestScore > 0) {
        const bk = buckets[best];
        result = [
          Math.round(bk.rSum / bk.satScore),
          Math.round(bk.gSum / bk.satScore),
          Math.round(bk.bSum / bk.satScore),
        ];
      }
      accentCache.set(imgSrc, result);
      resolve(result);
    };
    img.onerror = () => {
      accentCache.set(imgSrc, null);
      resolve(null);
    };
    img.src = imgSrc;
  });
}
