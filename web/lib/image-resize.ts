/**
 * Client-side image resize for evidence uploads.
 *
 * Phone photos commonly land at 2-5 MB and 4000+ px on the long edge. We cap
 * the longest edge at 2048 px before upload: keeps Supabase Storage costs flat
 * and, critically, keeps the downstream OpenAI image-token bill predictable.
 *
 * Strategy: `createImageBitmap` to decode + `OffscreenCanvas` to re-encode.
 * Both are available in current Chrome / Firefox / Safari. HEIC files can't
 * be decoded by any browser engine today — we detect them up front and bail
 * out with `resizeSkipped`, letting the caller upload the raw file so the
 * oracle can still process it.
 */

export const MAX_EDGE_PX = 2048;

export type ResizeResult =
  | { kind: 'resized'; blob: Blob; width: number; height: number }
  | { kind: 'skipped'; reason: 'heic' | 'unsupported' | 'no-op' };

const HEIC_MIMES = new Set(['image/heic', 'image/heif']);
const RESIZABLE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function isHeic(file: File): boolean {
  const mime = file.type?.toLowerCase() ?? '';
  if (HEIC_MIMES.has(mime)) return true;
  const name = file.name?.toLowerCase() ?? '';
  return name.endsWith('.heic') || name.endsWith('.heif');
}

function pickEncodeMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m === 'image/png') return 'image/png';
  if (m === 'image/webp') return 'image/webp';
  // Default to JPEG for everything else — smallest bytes for photographs.
  return 'image/jpeg';
}

function pickEncodeQuality(mime: string): number | undefined {
  // `toBlob`'s quality argument is ignored for PNG. Use 0.9 for JPEG/WebP —
  // visually indistinguishable from the original at 2048 px, ~4x smaller.
  return mime === 'image/png' ? undefined : 0.9;
}

/**
 * Resize an image file to `MAX_EDGE_PX` on its longest edge, preserving the
 * input mime where possible. Returns:
 *   - `resized` with a re-encoded Blob
 *   - `skipped` with a reason for HEIC / browsers that can't decode / images
 *     already within the cap (no-op; caller should upload the original file)
 */
export async function resizeImage(file: File): Promise<ResizeResult> {
  if (isHeic(file)) {
    return { kind: 'skipped', reason: 'heic' };
  }
  const mime = file.type?.toLowerCase() ?? '';
  if (!RESIZABLE_MIMES.has(mime)) {
    return { kind: 'skipped', reason: 'unsupported' };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { kind: 'skipped', reason: 'unsupported' };
  }

  try {
    const { width: srcW, height: srcH } = bitmap;
    const longest = Math.max(srcW, srcH);
    if (longest <= MAX_EDGE_PX) {
      return { kind: 'skipped', reason: 'no-op' };
    }
    const scale = MAX_EDGE_PX / longest;
    const dstW = Math.max(1, Math.round(srcW * scale));
    const dstH = Math.max(1, Math.round(srcH * scale));

    const outMime = pickEncodeMime(mime);
    const quality = pickEncodeQuality(outMime);

    // Prefer OffscreenCanvas (runs off the main thread when transferred to a
    // worker; here we just use it for its `convertToBlob` ergonomics). Fall
    // back to a DOM canvas + `toBlob` if OffscreenCanvas isn't available.
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(dstW, dstH);
      const ctx = canvas.getContext('2d');
      if (!ctx) return { kind: 'skipped', reason: 'unsupported' };
      ctx.drawImage(bitmap, 0, 0, dstW, dstH);
      const blob = await canvas.convertToBlob({ type: outMime, quality });
      return { kind: 'resized', blob, width: dstW, height: dstH };
    }

    const canvas = document.createElement('canvas');
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { kind: 'skipped', reason: 'unsupported' };
    ctx.drawImage(bitmap, 0, 0, dstW, dstH);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(
        (b) => resolve(b),
        outMime,
        quality,
      ),
    );
    if (!blob) return { kind: 'skipped', reason: 'unsupported' };
    return { kind: 'resized', blob, width: dstW, height: dstH };
  } finally {
    bitmap.close?.();
  }
}
