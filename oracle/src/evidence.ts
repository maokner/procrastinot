const MAX_TEXT_BYTES = 8 * 1024; // 8KB cap for text evidence
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB cap per image
const MAX_MANIFEST_IMAGES = 4;
const MANIFEST_FETCH_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 10_000;
const IMAGE_FETCH_TIMEOUT_MS = 20_000;

/**
 * Typed union returned by {@link resolveEvidence}. The judge branches on `kind`
 * to build OpenAI content parts.
 */
export type Evidence =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mime: string; dataBase64: string }
  | {
      kind: 'images';
      items: Array<{ mime: string; dataBase64: string }>;
      note?: string;
    };

function truncateToBytes(input: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  if (bytes.byteLength <= maxBytes) return input;
  const slice = bytes.slice(0, maxBytes);
  // Use fatal:false so we don't split a multibyte char.
  return new TextDecoder('utf-8', { fatal: false }).decode(slice);
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function ipfsToHttp(uri: string): string {
  const rest = uri.slice('ipfs://'.length).replace(/^\/+/, '');
  if (!rest) throw new Error('ipfs URI is empty');
  return `https://ipfs.io/ipfs/${rest}`;
}

function normalizeUri(uri: string): string {
  if (uri.startsWith('ipfs://')) return ipfsToHttp(uri);
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
  throw new Error(`unsupported evidenceURI scheme: ${uri.slice(0, 32)}`);
}

function parseMime(contentType: string | null): string {
  if (!contentType) return 'application/octet-stream';
  // strip params like "; charset=utf-8"
  return contentType.split(';')[0]!.trim().toLowerCase();
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

async function fetchImageAsBase64(
  url: string,
): Promise<{ mime: string; dataBase64: string }> {
  const res = await fetchWithTimeout(url, IMAGE_FETCH_TIMEOUT_MS);
  const mime = parseMime(res.headers.get('content-type'));
  if (!isImageMime(mime)) {
    throw new Error(`expected image/* from ${url}, got ${mime}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `image ${url} exceeds ${MAX_IMAGE_BYTES} bytes (got ${buf.byteLength})`,
    );
  }
  return { mime, dataBase64: buf.toString('base64') };
}

/**
 * Fan out an `images` manifest: fetch each URL in parallel, bounded to
 * {@link MANIFEST_FETCH_CONCURRENCY}. If any fetch fails we throw; the poller
 * treats that as an evidence failure and submits passed=false.
 */
async function fetchManifestImages(
  urls: string[],
): Promise<Array<{ mime: string; dataBase64: string }>> {
  if (urls.length === 0) {
    throw new Error('manifest images array is empty');
  }
  if (urls.length > MAX_MANIFEST_IMAGES) {
    throw new Error(
      `manifest has ${urls.length} images, max ${MAX_MANIFEST_IMAGES}`,
    );
  }

  const results: Array<{ mime: string; dataBase64: string }> = new Array(urls.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= urls.length) return;
      const raw = urls[i]!;
      const httpUrl = normalizeUri(raw);
      results[i] = await fetchImageAsBase64(httpUrl);
    }
  }
  const workers = Array.from(
    { length: Math.min(MANIFEST_FETCH_CONCURRENCY, urls.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

function maybeParseImagesManifest(raw: string): { urls: string[]; note?: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const obj = parsed as { kind?: unknown; urls?: unknown; note?: unknown };
  if (obj.kind !== 'images') {
    return null;
  }
  if (!Array.isArray(obj.urls) || obj.urls.some((u) => typeof u !== 'string')) {
    throw new Error('manifest.urls must be a string[]');
  }
  const note = typeof obj.note === 'string' ? obj.note : undefined;
  return { urls: obj.urls as string[], note };
}

/**
 * Resolve an evidence URI into a typed {@link Evidence} value.
 *
 * Supported schemes:
 *   - `text:<utf8>` — plain text, capped at 8 KB.
 *   - `http(s)://...` — when Content-Type is text/*, JSON, etc., treated as
 *     text (8 KB cap). When `application/json`, parsed as an `images` manifest
 *     and each referenced image is fetched (parallel, bounded to 4). When
 *     `image/*`, fetched as a single image (10 MB cap).
 *   - `ipfs://<cid>[/path]` — resolved through the public gateway, same
 *     content-type branching as above.
 *
 * Throws on failure/timeout. Callers (the poller) decide how to handle — the
 * current policy is to submit `passed=false` with a canonical reason.
 */
export async function resolveEvidence(uri: string): Promise<Evidence> {
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new Error('evidenceURI is empty');
  }

  if (uri.startsWith('text:')) {
    return {
      kind: 'text',
      text: truncateToBytes(uri.slice('text:'.length), MAX_TEXT_BYTES),
    };
  }

  const httpUrl = normalizeUri(uri);
  const res = await fetchWithTimeout(httpUrl, FETCH_TIMEOUT_MS);
  const mime = parseMime(res.headers.get('content-type'));

  // Single image: Content-Type image/*
  if (isImageMime(mime)) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(
        `image ${httpUrl} exceeds ${MAX_IMAGE_BYTES} bytes (got ${buf.byteLength})`,
      );
    }
    return { kind: 'image', mime, dataBase64: buf.toString('base64') };
  }

  // JSON manifest: fan out to individual images
  if (mime === 'application/json') {
    const raw = await res.text();
    const manifest = maybeParseImagesManifest(raw);
    if (manifest) {
      const items = await fetchManifestImages(manifest.urls);
      return { kind: 'images', items, note: manifest.note };
    }
    return { kind: 'text', text: truncateToBytes(raw, MAX_TEXT_BYTES) };
  }

  // Fallback: treat as text (HTML, plain text, unknown, etc.)
  const isTextLike =
    mime.startsWith('text/') ||
    mime.includes('json') ||
    mime.includes('xml') ||
    mime.includes('yaml') ||
    mime.includes('javascript') ||
    mime === 'application/octet-stream';
  if (isTextLike) {
    const text = await res.text();
    return { kind: 'text', text: truncateToBytes(text, MAX_TEXT_BYTES) };
  }

  // Unknown binary: base64 it into the text slot so the judge at least sees
  // something deterministic, capped at 8 KB (matches historical behaviour).
  const buf = Buffer.from(await res.arrayBuffer());
  const capped = buf.subarray(0, MAX_TEXT_BYTES);
  return { kind: 'text', text: capped.toString('base64') };
}
