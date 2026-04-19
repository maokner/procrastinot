const MAX_BYTES = 8 * 1024; // 8KB cap
const FETCH_TIMEOUT_MS = 10_000;

function truncateToBytes(input: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  if (bytes.byteLength <= maxBytes) return input;
  const slice = bytes.slice(0, maxBytes);
  // Use fatal:false so we don't split a multibyte char.
  return new TextDecoder('utf-8', { fatal: false }).decode(slice);
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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

async function readBody(res: Response): Promise<string> {
  const contentType = res.headers.get('content-type') ?? '';
  const isText =
    contentType.startsWith('text/') ||
    contentType.includes('json') ||
    contentType.includes('xml') ||
    contentType.includes('yaml') ||
    contentType.includes('javascript') ||
    contentType === '';
  if (isText) {
    const text = await res.text();
    return truncateToBytes(text, MAX_BYTES);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const capped = buf.subarray(0, MAX_BYTES);
  return capped.toString('base64');
}

/**
 * Resolve an evidence URI into a UTF-8 string (≤ 8KB).
 * Supported schemes:
 *   - text:<utf8>
 *   - http(s)://...
 *   - ipfs://<cid>[/path]  (resolved via https://ipfs.io/ipfs/...)
 *
 * Throws on failure/timeout. Caller decides how to handle.
 */
export async function resolveEvidence(uri: string): Promise<string> {
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new Error('evidenceURI is empty');
  }

  if (uri.startsWith('text:')) {
    return truncateToBytes(uri.slice('text:'.length), MAX_BYTES);
  }

  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    const res = await fetchWithTimeout(uri);
    return readBody(res);
  }

  if (uri.startsWith('ipfs://')) {
    const rest = uri.slice('ipfs://'.length).replace(/^\/+/, '');
    if (!rest) throw new Error('ipfs URI is empty');
    const res = await fetchWithTimeout(`https://ipfs.io/ipfs/${rest}`);
    return readBody(res);
  }

  throw new Error(`unsupported evidenceURI scheme: ${uri.slice(0, 32)}`);
}
