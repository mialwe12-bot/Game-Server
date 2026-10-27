import { Transform, type TransformCallback } from 'node:stream';

/**
 * Token-Bucket-Drossel für Streams. bytesPerSecond <= 0 bedeutet unbegrenzt.
 */
export class ThrottleStream extends Transform {
  private allowance: number;
  private last = Date.now();

  constructor(private readonly bytesPerSecond: number) {
    super();
    this.allowance = bytesPerSecond;
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, callback: TransformCallback): void {
    if (this.bytesPerSecond <= 0) {
      callback(null, chunk);
      return;
    }
    this.sendChunk(chunk, 0, callback);
  }

  private sendChunk(chunk: Buffer, offset: number, callback: TransformCallback): void {
    const now = Date.now();
    this.allowance = Math.min(
      this.bytesPerSecond,
      this.allowance + ((now - this.last) / 1000) * this.bytesPerSecond,
    );
    this.last = now;
    if (this.allowance >= 1) {
      const n = Math.min(chunk.length - offset, Math.floor(this.allowance));
      this.push(chunk.subarray(offset, offset + n));
      this.allowance -= n;
      offset += n;
    }
    if (offset >= chunk.length) {
      callback();
      return;
    }
    const waitMs = Math.max(5, Math.ceil(((1 - this.allowance) / this.bytesPerSecond) * 1000));
    setTimeout(() => {
      if (this.destroyed) return;
      this.sendChunk(chunk, offset, callback);
    }, Math.min(waitMs, 250));
  }
}
