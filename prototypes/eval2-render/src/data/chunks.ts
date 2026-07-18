// PROTOTYPE — per-sequence chunk store. Chunk starts are derived from the
// shell's `sequences` boundaries (the stand-in for the zip central directory);
// index→chunk is a binary search over starts, per the framing doc.

import { fetchJson } from "./fetchLog";
import type { EventLite, MessageLite, SequenceName, Shell } from "./types";

export class ChunkStore<T> {
  readonly starts: number[]; // chunk start indexes, ascending
  readonly ends: number[]; // cumulative end-exclusive boundaries
  readonly count: number;
  private cache = new Map<number, Promise<T[]>>();

  constructor(
    private samplePath: string,
    private sequence: SequenceName,
    boundaries: number[],
  ) {
    this.ends = boundaries;
    this.starts = [0, ...boundaries.slice(0, -1)];
    this.count = boundaries.length > 0 ? boundaries[boundaries.length - 1] : 0;
  }

  /** index of the chunk holding item `i`: greatest start ≤ i */
  chunkIndexOf(i: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= i) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  isLoaded(chunkIdx: number): boolean {
    return this.cache.has(this.starts[chunkIdx]);
  }

  loadChunk(chunkIdx: number): Promise<T[]> {
    const start = this.starts[chunkIdx];
    let p = this.cache.get(start);
    if (!p) {
      p = fetchJson<T[]>(`${this.samplePath}/${this.sequence}/${start}.json`, this.sequence);
      this.cache.set(start, p);
    }
    return p;
  }

  /** items [lo, hi) — fetches the covering chunks in parallel */
  async getRange(lo: number, hi: number): Promise<T[]> {
    hi = Math.min(hi, this.count);
    if (hi <= lo) return [];
    const firstChunk = this.chunkIndexOf(lo);
    const lastChunk = this.chunkIndexOf(hi - 1);
    const chunks = await Promise.all(
      Array.from({ length: lastChunk - firstChunk + 1 }, (_, k) => this.loadChunk(firstChunk + k)),
    );
    const items = chunks.flat();
    const base = this.starts[firstChunk];
    return items.slice(lo - base, hi - base);
  }

  clear() {
    this.cache.clear();
  }
}

export const makeStores = (samplePath: string, shell: Shell) => ({
  messages: new ChunkStore<MessageLite>(samplePath, "messages", shell.sequences.messages ?? []),
  events: new ChunkStore<EventLite>(samplePath, "events", shell.sequences.events ?? []),
  calls: new ChunkStore<unknown>(samplePath, "calls", shell.sequences.calls ?? []),
  attachments: new ChunkStore<string>(samplePath, "attachments", shell.sequences.attachments ?? []),
});
