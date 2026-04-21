/**
 * Browser-side Supabase Storage wrapper for commitment evidence uploads.
 *
 * Paths follow the convention:
 *   ${profileId}/${commitmentId}/${attempt}-${index}.${ext}
 *   ${profileId}/${commitmentId}/${attempt}-manifest.json
 *
 * The first path segment MUST equal the uploader's `auth.uid()` or the
 * storage.objects INSERT policy defined in
 * `supabase/migrations/0004_evidence_storage.sql` rejects the upload.
 *
 * The bucket is public, so we return the permanent public URL directly — no
 * signed-URL plumbing on the oracle side.
 */
import { supabaseBrowser } from './supabase';

export const EVIDENCE_BUCKET = 'evidence';

export type UploadEvidenceArgs = {
  profileId: string;
  commitmentId: string | bigint;
  attempt: number;
  index: number;
};

export type UploadedEvidence = {
  path: string;
  publicUrl: string;
};

/**
 * Map a MIME type to a sensible file extension. Falls back to the extension
 * embedded in the original filename, then to `bin`.
 */
function extFor(file: File | Blob, originalName?: string): string {
  const mime = file.type?.toLowerCase() ?? '';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/heic' || mime === 'image/heif') return 'heic';
  if (mime === 'application/json') return 'json';
  const name = originalName ?? (file as File).name ?? '';
  const dot = name.lastIndexOf('.');
  if (dot >= 0 && dot < name.length - 1) {
    return name.slice(dot + 1).toLowerCase();
  }
  return 'bin';
}

function assertProfileId(profileId: string) {
  if (!profileId) {
    throw new Error(
      'uploadEvidence: profileId is required (must match auth.uid() or the INSERT policy rejects).',
    );
  }
}

/**
 * Upload a single evidence image. `source` is typically the resized Blob
 * returned by `resizeImage()` in `./image-resize`; for HEIC and other
 * un-decodable inputs, pass the original `File` through.
 */
export async function uploadEvidenceImage(
  source: Blob | File,
  args: UploadEvidenceArgs & { originalFile?: File },
): Promise<UploadedEvidence> {
  const { profileId, commitmentId, attempt, index, originalFile } = args;
  assertProfileId(profileId);

  const ext = extFor(source, originalFile?.name);
  const path = `${profileId}/${String(commitmentId)}/${attempt}-${index}.${ext}`;
  const contentType = source.type || 'application/octet-stream';

  const sb = supabaseBrowser();
  const { error } = await sb.storage.from(EVIDENCE_BUCKET).upload(path, source, {
    cacheControl: '31536000',
    contentType,
    upsert: true,
  });
  if (error) {
    throw new Error(`evidence upload failed (${path}): ${error.message}`);
  }
  const { data } = sb.storage.from(EVIDENCE_BUCKET).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

/**
 * Upload the JSON manifest that aggregates one attempt's uploaded images.
 * The returned URL is what gets written on-chain via `requestVerdict`.
 */
export async function uploadEvidenceManifest(
  manifest: {
    kind: 'images';
    urls: string[];
    note?: string;
  },
  args: UploadEvidenceArgs,
): Promise<UploadedEvidence> {
  const { profileId, commitmentId, attempt } = args;
  assertProfileId(profileId);

  const path = `${profileId}/${String(commitmentId)}/${attempt}-manifest.json`;
  const body = new Blob([JSON.stringify(manifest)], { type: 'application/json' });

  const sb = supabaseBrowser();
  const { error } = await sb.storage.from(EVIDENCE_BUCKET).upload(path, body, {
    cacheControl: '60',
    contentType: 'application/json',
    upsert: true,
  });
  if (error) {
    throw new Error(`manifest upload failed (${path}): ${error.message}`);
  }
  const { data } = sb.storage.from(EVIDENCE_BUCKET).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

/**
 * True for any public URL pointing at our evidence bucket — used by the
 * verdict renderer to decide whether to try to fetch + unpack a manifest.
 */
export function isEvidenceStorageUrl(uri: string): boolean {
  if (!uri) return false;
  try {
    const u = new URL(uri);
    if (!/\.supabase\.co$/.test(u.hostname) && !/\.supabase\.in$/.test(u.hostname)) {
      return false;
    }
    return u.pathname.includes(`/storage/v1/object/public/${EVIDENCE_BUCKET}/`);
  } catch {
    return false;
  }
}
