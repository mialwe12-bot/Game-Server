import { useSyncExternalStore } from 'react';
import { ResumableUpload, type UploadProgress } from '@gameserver/shared';
import { api } from './api';

export interface QueueItem {
  key: string;
  buildId: string;
  path: string;
  label: string;
  size: number;
  upload: ResumableUpload;
  progress: UploadProgress;
  onDone?: () => void;
}

const CONCURRENCY = 3;
let items: QueueItem[] = [];
const listeners = new Set<() => void>();
const emit = () => {
  items = [...items];
  listeners.forEach((l) => l());
};

function pump() {
  const active = items.filter((i) => i.progress.state === 'uploading').length;
  const waiting = items.filter((i) => i.progress.state === 'idle');
  for (const item of waiting.slice(0, Math.max(0, CONCURRENCY - active))) void start(item);
}

async function start(item: QueueItem) {
  item.progress = { ...item.progress, state: 'uploading' };
  emit();
  await item.upload.start();
  if (item.progress.state === 'completed') item.onDone?.();
  pump();
}

/** Fügt Dateien zur globalen Upload-Warteschlange hinzu (läuft weiter, während man im Admin-Panel navigiert). */
export function enqueueUploads(buildId: string, files: { file: File; path: string }[], label: string, onDone?: () => void) {
  for (const { file, path } of files) {
    const key = `${buildId}:${path}:${file.size}`;
    const existing = items.find((i) => i.key === key && i.progress.state !== 'completed' && i.progress.state !== 'cancelled');
    if (existing) continue;
    const item: QueueItem = {
      key,
      buildId,
      path,
      label,
      size: file.size,
      onDone,
      progress: { state: 'idle', uploaded: 0, total: file.size, speed: 0 },
      upload: undefined as unknown as ResumableUpload,
    };
    item.upload = new ResumableUpload(api, file, {
      buildId,
      path,
      onProgress: (p) => {
        item.progress = p;
        emit();
      },
    });
    items.push(item);
  }
  emit();
  pump();
}

export const uploadQueue = {
  pause(key: string) {
    items.find((i) => i.key === key)?.upload.pause();
    pump();
  },
  resume(key: string) {
    const item = items.find((i) => i.key === key);
    if (item) void start(item);
  },
  async cancel(key: string) {
    const item = items.find((i) => i.key === key);
    if (!item) return;
    await item.upload.cancel();
    items = items.filter((i) => i !== item);
    emit();
    pump();
  },
  pauseAll() {
    for (const i of items) if (i.progress.state === 'uploading') i.upload.pause();
  },
  clearDone() {
    items = items.filter((i) => !['completed', 'cancelled'].includes(i.progress.state));
    emit();
  },
  hasActive: () => items.some((i) => i.progress.state === 'uploading' || i.progress.state === 'idle'),
};

window.addEventListener('beforeunload', (e) => {
  if (uploadQueue.hasActive()) {
    e.preventDefault();
  }
});

export function useUploadQueue(): QueueItem[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
  );
}
