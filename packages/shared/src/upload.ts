import { ApiError, type ApiClient } from './api.js';
import type { UploadDto } from './types.js';

export type UploadState = 'idle' | 'uploading' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface UploadProgress {
  state: UploadState;
  uploaded: number;
  total: number;
  /** Bytes pro Sekunde (gleitender Mittelwert). */
  speed: number;
  error?: string;
  upload?: UploadDto;
}

export interface ResumableUploadOptions {
  buildId: string;
  path: string;
  sha256?: string;
  /** Wird bei jeder Fortschrittsänderung aufgerufen. */
  onProgress?: (p: UploadProgress) => void;
  /** Maximale Wiederholungen pro Chunk bei Netzwerkfehlern. */
  maxRetries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fortsetzbarer Chunk-Upload großer Dateien (mehrere GB) mit Pause/Fortsetzen.
 * Funktioniert im Browser (XHR mit Feinfortschritt) und überall, wo fetch verfügbar ist.
 * Nach einem Seiten-Reload wird ein laufender Upload über (Build, Pfad, Größe) erkannt und fortgesetzt.
 */
export class ResumableUpload {
  private uploadId: string | null = null;
  private chunkSize = 16 * 1024 * 1024;
  private offset = 0;
  private state: UploadState = 'idle';
  private abort: (() => void) | null = null;
  private speed = 0;
  private running: Promise<void> | null = null;
  private lastError: string | undefined;
  private result: UploadDto | undefined;

  constructor(
    private readonly api: ApiClient,
    private readonly file: Blob,
    private readonly opts: ResumableUploadOptions,
  ) {}

  get progress(): UploadProgress {
    return {
      state: this.state,
      uploaded: this.offset,
      total: this.file.size,
      speed: this.speed,
      error: this.lastError,
      upload: this.result,
    };
  }

  private emit(): void {
    this.opts.onProgress?.(this.progress);
  }

  /** Startet oder setzt den Upload fort. Löst auf, wenn fertig, pausiert oder abgebrochen. */
  start(): Promise<void> {
    if (this.state === 'uploading' && this.running) return this.running;
    if (this.state === 'completed' || this.state === 'cancelled') return Promise.resolve();
    this.state = 'uploading';
    this.lastError = undefined;
    this.emit();
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  resume(): Promise<void> {
    return this.start();
  }

  pause(): void {
    if (this.state !== 'uploading') return;
    this.state = 'paused';
    this.abort?.();
    this.emit();
  }

  async cancel(): Promise<void> {
    const wasRunning = this.running;
    this.state = 'cancelled';
    this.abort?.();
    await wasRunning?.catch(() => undefined);
    if (this.uploadId) await this.api.uploads.cancel(this.uploadId).catch(() => undefined);
    this.emit();
  }

  private async run(): Promise<void> {
    try {
      if (!this.uploadId) {
        const created = await this.api.uploads.create({
          buildId: this.opts.buildId,
          path: this.opts.path,
          size: this.file.size,
          sha256: this.opts.sha256,
        });
        this.uploadId = created.id;
        this.chunkSize = created.chunkSize;
        this.offset = created.offset;
        if (created.status === 'COMPLETED') return this.finish(created);
        if (created.status === 'FAILED') return this.fail(created.error ?? 'Upload fehlgeschlagen', created);
      } else {
        const status = await this.api.uploads.get(this.uploadId);
        this.offset = status.offset;
        if (status.status === 'COMPLETED') return this.finish(status);
      }
      this.emit();

      let retries = 0;
      while (this.offset < this.file.size) {
        if (this.state !== 'uploading') return;
        const end = Math.min(this.offset + this.chunkSize, this.file.size);
        try {
          const res = await this.sendChunk(this.offset, end);
          retries = 0;
          this.offset = res.offset;
          if (res.status === 'COMPLETED') return this.finish(res);
          if (res.status === 'FAILED') return this.fail(res.error ?? 'Upload fehlgeschlagen', res);
          this.emit();
        } catch (err) {
          if (this.state !== 'uploading') return; // pausiert/abgebrochen
          if (err instanceof ApiError) {
            if (err.code === 'offset_mismatch') {
              const d = err.details as { offset?: number } | undefined;
              this.offset = d?.offset ?? (await this.api.uploads.get(this.uploadId!)).offset;
              continue;
            }
            if (err.status < 500 && err.status !== 429 && err.code !== 'upload_locked') throw err;
          }
          if (++retries > (this.opts.maxRetries ?? 8)) throw err;
          await sleep(Math.min(30_000, 1000 * 2 ** (retries - 1)));
          // Nach Netzwerkfehler den echten Server-Stand abfragen
          try {
            this.offset = (await this.api.uploads.get(this.uploadId!)).offset;
          } catch {
            // nächster Versuch
          }
        }
      }
    } catch (err) {
      if (this.state === 'uploading') this.fail(err instanceof Error ? err.message : String(err));
    }
  }

  private finish(upload: UploadDto) {
    this.offset = upload.size;
    this.result = upload;
    this.state = 'completed';
    this.emit();
  }

  private fail(message: string, upload?: UploadDto) {
    this.lastError = message;
    this.result = upload;
    this.state = 'failed';
    this.emit();
  }

  private sendChunk(start: number, end: number): Promise<UploadDto> {
    const url = `${this.api.baseUrl}/api/uploads/${this.uploadId}`;
    const headers: Record<string, string> = {
      ...this.api.authHeaders('PATCH'),
      'Content-Type': 'application/offset+octet-stream',
      'Upload-Offset': String(start),
    };
    const blob = this.file.slice(start, end);
    const began = Date.now();
    const updateSpeed = (bytes: number) => {
      const secs = (Date.now() - began) / 1000;
      if (secs > 0.2) this.speed = this.speed ? this.speed * 0.7 + (bytes / secs) * 0.3 : bytes / secs;
    };

    if (typeof XMLHttpRequest !== 'undefined') {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PATCH', url);
        xhr.withCredentials = !this.api.token;
        for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
        xhr.upload.onprogress = (e) => {
          updateSpeed(e.loaded);
          this.opts.onProgress?.({ ...this.progress, uploaded: start + e.loaded });
        };
        xhr.onload = () => {
          let body: { error?: string; message?: string; details?: unknown } & Partial<UploadDto> = {};
          try {
            body = JSON.parse(xhr.responseText);
          } catch {
            // leer
          }
          if (xhr.status >= 200 && xhr.status < 300) resolve(body as UploadDto);
          else reject(new ApiError(xhr.status, body.error ?? 'http_error', body.message ?? xhr.statusText, body.details));
        };
        xhr.onerror = () => reject(new Error('Netzwerkfehler'));
        xhr.onabort = () => reject(new Error('abgebrochen'));
        this.abort = () => xhr.abort();
        xhr.send(blob);
      });
    }

    const controller = new AbortController();
    this.abort = () => controller.abort();
    return this.api
      .request<UploadDto>('PATCH', `/uploads/${this.uploadId}`, { body: blob, headers, signal: controller.signal })
      .then((r) => {
        updateSpeed(end - start);
        return r;
      });
  }
}
