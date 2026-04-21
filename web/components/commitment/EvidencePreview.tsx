'use client';

import { useEffect, useState } from 'react';
import {
  isEvidenceManifestUrl,
  isEvidenceStorageUrl,
  type EvidenceManifest,
} from '@/lib/storage';

type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'manifest'; manifest: EvidenceManifest }
  | { kind: 'image'; url: string }
  | { kind: 'error'; message: string };

function normalizeManifest(data: unknown): EvidenceManifest | null {
  if (!data || typeof data !== 'object') return null;
  const kind = Reflect.get(data, 'kind');
  const urls = Reflect.get(data, 'urls');
  const note = Reflect.get(data, 'note');
  if (kind !== 'images' || !Array.isArray(urls)) return null;
  const cleanUrls = urls.filter((item): item is string => typeof item === 'string');
  return {
    kind: 'images',
    urls: cleanUrls,
    note: typeof note === 'string' && note.trim() ? note.trim() : undefined,
  };
}

function displayUri(uri: string): string {
  if (uri.startsWith('text:')) return uri.slice(5);
  return uri;
}

export function EvidencePreview({ uri }: { uri: string }) {
  const [preview, setPreview] = useState<PreviewState>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isEvidenceStorageUrl(uri)) {
        setPreview({ kind: 'idle' });
        return;
      }

      setPreview({ kind: 'loading' });

      try {
        const res = await fetch(uri, { cache: 'force-cache' });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const contentType = res.headers.get('content-type')?.toLowerCase() ?? '';
        if (contentType.startsWith('image/')) {
          if (!cancelled) setPreview({ kind: 'image', url: uri });
          return;
        }

        if (contentType.includes('application/json') || isEvidenceManifestUrl(uri)) {
          const manifest = normalizeManifest(await res.json());
          if (!manifest) {
            throw new Error('Manifest shape invalid');
          }
          if (!cancelled) setPreview({ kind: 'manifest', manifest });
          return;
        }

        if (!cancelled) {
          setPreview({ kind: 'error', message: 'Storage object is not an image manifest.' });
        }
      } catch (error) {
        if (!cancelled) {
          setPreview({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Failed to load preview.',
          });
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [uri]);

  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="break-all font-mono text-xs text-neutral-400">{displayUri(uri)}</p>

      {preview.kind === 'loading' && (
        <p className="text-xs text-neutral-500">Loading evidence preview…</p>
      )}

      {preview.kind === 'manifest' && (
        <>
          {preview.manifest.note && (
            <p className="rounded border border-neutral-800 bg-neutral-900/60 p-2 text-xs text-neutral-300">
              {preview.manifest.note}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {preview.manifest.urls.map((url, index) => (
              <a
                key={`${url}-${index}`}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="overflow-hidden rounded border border-neutral-800 bg-neutral-900"
              >
                {/* Plain img keeps remote storage URLs simple; no next/image domain config required. */}
                <img
                  src={url}
                  alt={`Evidence photo ${index + 1}`}
                  className="aspect-square h-full w-full object-cover"
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        </>
      )}

      {preview.kind === 'image' && (
        <a
          href={preview.url}
          target="_blank"
          rel="noreferrer"
          className="max-w-48 overflow-hidden rounded border border-neutral-800 bg-neutral-900"
        >
          <img
            src={preview.url}
            alt="Evidence photo"
            className="aspect-square h-full w-full object-cover"
            loading="lazy"
          />
        </a>
      )}

      {preview.kind === 'error' && (
        <p className="text-xs text-amber-300">
          Preview unavailable: {preview.message}
        </p>
      )}
    </div>
  );
}
