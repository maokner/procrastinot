'use client';

import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import type { Abi, Hex } from 'viem';
import { procrastinotAbi } from '@procrastinot/abi';
import { CONTRACT_ADDRESS, CHAIN_ID } from '@/lib/contract';
import { etherscanTxUrl, toEvidenceURI } from '@/lib/format';
import { resizeImage } from '@/lib/image-resize';
import {
  uploadEvidenceImage,
  uploadEvidenceManifest,
  type EvidenceManifest,
} from '@/lib/storage';

const abi = procrastinotAbi as unknown as Abi;
const MAX_FILES = 4;
const ACCEPTED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

type Mode = 'photo' | 'text';
type UploadStage = 'queued' | 'resizing' | 'uploading' | 'uploaded' | 'error';

type PendingUpload = {
  id: string;
  file: File;
  progress: number;
  stage: UploadStage;
  detail?: string;
  error?: string;
  publicUrl?: string;
};

function fileId(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function acceptsFile(file: File): boolean {
  const mime = file.type.toLowerCase();
  if (ACCEPTED_IMAGE_MIMES.has(mime)) return true;
  const lower = file.name.toLowerCase();
  return lower.endsWith('.heic') || lower.endsWith('.heif');
}

function stageLabel(upload: PendingUpload): string {
  if (upload.stage === 'error') return upload.error ?? 'Upload failed';
  if (upload.stage === 'uploaded') return upload.detail ?? 'Uploaded';
  if (upload.stage === 'uploading') return upload.detail ?? 'Uploading to storage…';
  if (upload.stage === 'resizing') return 'Resizing…';
  return 'Queued';
}

function createPendingUpload(file: File): PendingUpload {
  return {
    id: fileId(file),
    file,
    progress: 0,
    stage: 'queued',
  };
}

export function SubmitEvidenceForm({
  id,
  viewerProfileId,
  attempt,
}: {
  id: bigint;
  viewerProfileId: string | null;
  attempt: number;
}) {
  const [mode, setMode] = useState<Mode>('photo');
  const [textEvidence, setTextEvidence] = useState('');
  const [photoNote, setPhotoNote] = useState('');
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const pickerRef = useRef<HTMLInputElement | null>(null);
  const { writeContractAsync, isPending: writing } = useWriteContract();
  const rx = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    query: { enabled: Boolean(txHash) },
  });

  const busy = writing || rx.isLoading || uploading;

  function updateUpload(id: string, patch: Partial<PendingUpload>) {
    setUploads((prev) =>
      prev.map((upload) => (upload.id === id ? { ...upload, ...patch } : upload)),
    );
  }

  function addFiles(nextFiles: File[]) {
    setErr(null);

    const valid = nextFiles.filter(acceptsFile);
    const invalid = nextFiles.filter((file) => !acceptsFile(file));
    const existing = new Set(uploads.map((upload) => upload.id));
    const deduped = valid.filter((file) => !existing.has(fileId(file)));
    const remainingSlots = Math.max(0, MAX_FILES - uploads.length);
    const accepted = deduped.slice(0, remainingSlots).map(createPendingUpload);

    if (accepted.length > 0) {
      setUploads((prev) => [...prev, ...accepted]);
    }

    if (invalid.length > 0) {
      setErr(
        `Unsupported file type: ${invalid.map((file) => file.name).join(', ')}. Use JPEG, PNG, WebP, or HEIC.`,
      );
      return;
    }

    if (valid.length !== deduped.length) {
      setErr('Skipped duplicate files with the same name and timestamp.');
      return;
    }

    if (deduped.length > remainingSlots) {
      setErr(`You can upload up to ${MAX_FILES} photos per attempt.`);
    }
  }

  function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;
    addFiles(Array.from(e.target.files));
    e.target.value = '';
  }

  function onDropFiles(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (!e.dataTransfer.files?.length) return;
    addFiles(Array.from(e.dataTransfer.files));
  }

  async function requestVerdict(uri: string) {
    const hash = await writeContractAsync({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi,
      functionName: 'requestVerdict',
      args: [id, uri],
    });
    setTxHash(hash);
  }

  async function submitTextEvidence() {
    if (!textEvidence.trim()) {
      throw new Error('Evidence cannot be empty.');
    }
    await requestVerdict(toEvidenceURI(textEvidence));
  }

  async function submitPhotoEvidence() {
    if (!viewerProfileId) {
      throw new Error('Photo uploads require a signed-in session. Use Link / text if you only connected a wallet.');
    }
    if (uploads.length === 0) {
      throw new Error('Pick at least one photo.');
    }

    setUploading(true);
    setUploads((prev) =>
      prev.map((upload) => ({
        ...upload,
        progress: 0,
        stage: 'queued',
        error: undefined,
        detail: undefined,
        publicUrl: undefined,
      })),
    );

    try {
      const uploadedUrls: string[] = [];

      for (const [index, upload] of uploads.entries()) {
        updateUpload(upload.id, { stage: 'resizing', progress: 15 });

        try {
          const resized = await resizeImage(upload.file);
          const source = resized.kind === 'resized' ? resized.blob : upload.file;
          const detail =
            resized.kind === 'resized'
              ? `Resized to ${resized.width}×${resized.height}`
              : resized.reason === 'heic'
                ? 'HEIC uploaded unchanged'
                : resized.reason === 'no-op'
                  ? 'Original size kept'
                  : 'Original uploaded';

          updateUpload(upload.id, {
            stage: 'uploading',
            progress: 65,
            detail,
          });

          const uploaded = await uploadEvidenceImage(source, {
            profileId: viewerProfileId,
            commitmentId: id,
            attempt,
            index,
            originalFile: upload.file,
          });

          uploadedUrls.push(uploaded.publicUrl);
          updateUpload(upload.id, {
            stage: 'uploaded',
            progress: 100,
            detail,
            publicUrl: uploaded.publicUrl,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Upload failed.';
          updateUpload(upload.id, {
            stage: 'error',
            progress: 0,
            error: message,
          });
          throw error;
        }
      }

      const manifest: EvidenceManifest = {
        kind: 'images',
        urls: uploadedUrls,
        note: photoNote.trim() || undefined,
      };
      const manifestUpload = await uploadEvidenceManifest(manifest, {
        profileId: viewerProfileId,
        commitmentId: id,
        attempt,
        index: 0,
      });

      await requestVerdict(manifestUpload.publicUrl);
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setTxHash(null);

    if (!CONTRACT_ADDRESS) {
      setErr('Contract not configured.');
      return;
    }

    try {
      if (mode === 'photo') {
        await submitPhotoEvidence();
        return;
      }
      await submitTextEvidence();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Failed to submit evidence.');
    }
  }

  if (rx.isSuccess) {
    return (
      <div className="pn-panel flex flex-col gap-4 rounded-2xl p-6">
        <h2 className="text-xl font-bold text-[var(--success)]">Evidence submitted</h2>
        <p className="text-sm text-[var(--ink-1)]">
          The oracle is judging this attempt. This page updates automatically when the verdict lands.
        </p>
        {txHash && (
          <a
            href={etherscanTxUrl(txHash, CHAIN_ID)}
            target="_blank"
            rel="noreferrer"
            className="pn-btn pn-btn-secondary self-start text-sm"
          >
            View transaction
          </a>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="pn-panel flex flex-col gap-4 rounded-2xl p-4"
    >
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMode('photo')}
          className={`pn-btn px-3 py-2 text-sm font-medium ${
            mode === 'photo'
              ? 'pn-btn-primary'
              : 'pn-btn-secondary'
          }`}
        >
          Photo
        </button>
        <button
          type="button"
          onClick={() => setMode('text')}
          className={`pn-btn px-3 py-2 text-sm font-medium ${
            mode === 'text'
              ? 'pn-btn-primary'
              : 'pn-btn-secondary'
          }`}
        >
          Link / text
        </button>
      </div>

      {mode === 'photo' ? (
        <>
          <input
            ref={pickerRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            multiple
            hidden
            onChange={onPickFiles}
          />

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDropFiles}
            className={`rounded-xl border border-dashed p-5 text-sm transition ${
              dragging
                ? 'border-[var(--accent)] bg-[var(--accent-soft)]/45'
                : 'border-[var(--line)] bg-white/65'
            }`}
          >
            <div className="flex flex-col gap-2">
              <p className="font-medium text-[var(--ink-0)]">
                Drag in up to {MAX_FILES} photos, or pick them manually.
              </p>
              <p className="text-[var(--ink-2)]">
                Accepted: JPEG, PNG, WebP, HEIC. Images are resized to a 2048px max edge when the browser can decode them.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => pickerRef.current?.click()}
                  className="pn-btn pn-btn-secondary text-sm"
                >
                  Choose photos
                </button>
                {uploads.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setUploads([])}
                    disabled={busy}
                    className="pn-btn pn-btn-secondary text-sm"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-[var(--ink-1)]">Optional note</span>
            <textarea
              value={photoNote}
              onChange={(e) => setPhotoNote(e.target.value)}
              rows={3}
              placeholder="What should the oracle notice in these photos?"
              className="pn-textarea"
            />
          </label>

          {!viewerProfileId && (
            <p className="rounded-xl border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[var(--accent-soft)]/60 p-3 text-sm text-[var(--ink-1)]">
              Photo uploads need a live Supabase session because Storage RLS keys uploads off `auth.uid()`. If you only have a connected wallet, switch to Link / text.
            </p>
          )}

          {uploads.length > 0 && (
            <ul className="flex flex-col gap-2">
              {uploads.map((upload) => (
                <li
                  key={upload.id}
                  className="rounded-xl border border-[var(--line)] bg-white/60 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--ink-0)]">
                        {upload.file.name}
                      </p>
                      <p className="text-xs text-[var(--ink-2)]">
                        {(upload.file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setUploads((prev) => prev.filter((item) => item.id !== upload.id))
                      }
                      disabled={busy}
                      className="text-xs text-[var(--ink-2)] underline hover:text-[var(--ink-0)] disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded bg-[var(--line)]">
                    <div
                      className={`h-full transition-all ${
                        upload.stage === 'error'
                          ? 'bg-[var(--danger)]'
                          : upload.stage === 'uploaded'
                            ? 'bg-[var(--success)]'
                            : 'bg-[var(--ink-1)]'
                      }`}
                      style={{ width: `${upload.progress}%` }}
                    />
                  </div>
                  <p
                    className={`mt-2 text-xs ${
                      upload.stage === 'error' ? 'text-[var(--danger)]' : 'text-[var(--ink-2)]'
                    }`}
                  >
                    {stageLabel(upload)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-[var(--ink-1)]">Evidence</span>
          <textarea
            value={textEvidence}
            onChange={(e) => setTextEvidence(e.target.value)}
            rows={3}
            placeholder="Paste text, a URL, or ipfs://…"
            className="pn-textarea"
          />
        </label>
      )}

      <button
        type="submit"
        disabled={busy}
        className="pn-btn pn-btn-primary self-start"
      >
        {uploading
          ? 'Uploading photos…'
          : writing
            ? 'Signing…'
            : rx.isLoading
              ? 'Confirming…'
              : mode === 'photo'
                ? 'Upload photos & submit'
                : 'Submit evidence'}
      </button>

      {err && (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_35%,var(--line))] bg-[color-mix(in_srgb,var(--danger)_10%,white)] p-3 text-sm text-[var(--danger)]">
          {err}
        </p>
      )}

      {txHash && (
        <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-white/60 p-3 text-sm">
          <span>{rx.isSuccess ? '✓ submitted' : '… submitting'}</span>
          <a
            href={etherscanTxUrl(txHash, CHAIN_ID)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-[var(--ink-2)] underline"
          >
            etherscan
          </a>
        </div>
      )}
    </form>
  );
}
