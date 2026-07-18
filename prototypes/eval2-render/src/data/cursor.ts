// PROTOTYPE — Layer 1 of the view-row pagination draft: the filtered cursor
// primitive. `max` counts SURVIVING events; per-chunk type counts (stats.json)
// let it skip non-matching chunks unread — the filter-pushdown mechanism.

import type { ChunkStore } from "./chunks";
import type { ChunkStats, EventLite } from "./types";

export interface OrdinalEvent {
  ordinal: number;
  ev: EventLite;
}

const REFILL = 64; // ≈ one screenful of surviving events

export class FilteredCursor {
  private buffer: OrdinalEvent[] = [];
  private from: number; // next unexamined ordinal
  private exhausted = false;

  constructor(
    private store: ChunkStore<EventLite>,
    private stats: ChunkStats[],
    start: number,
    /** survival predicate over event type; span_begin/span_end are the
     * caller's job to force-include (structure drives the walk) */
    private survives: (type: string) => boolean,
  ) {
    this.from = start;
  }

  get done(): boolean {
    return this.buffer.length === 0 && this.exhausted;
  }

  private chunkSurvivorCount(chunkIdx: number): number {
    const st = this.stats[chunkIdx];
    if (!st) return 1; // no stats — must read
    return Object.entries(st.type_counts).reduce(
      (n, [t, c]) => n + (this.survives(t) ? c : 0),
      0,
    );
  }

  statsFor(chunkIdx: number): ChunkStats | undefined {
    return this.stats[chunkIdx];
  }

  chunkIndexOf(ordinal: number): number {
    return this.store.chunkIndexOf(ordinal);
  }

  chunkBounds(chunkIdx: number): [number, number] {
    return [this.store.starts[chunkIdx], this.store.ends[chunkIdx]];
  }

  private async refill(): Promise<void> {
    while (this.buffer.length < REFILL && !this.exhausted) {
      if (this.from >= this.store.count) {
        this.exhausted = true;
        return;
      }
      const chunkIdx = this.store.chunkIndexOf(this.from);
      const [lo, hi] = this.chunkBounds(chunkIdx);
      if (this.chunkSurvivorCount(chunkIdx) === 0) {
        this.from = hi; // pushdown: skip the chunk unread
        continue;
      }
      const items = await this.store.loadChunk(chunkIdx);
      for (let i = this.from - lo; i < items.length; i++) {
        if (this.survives(items[i].event)) {
          this.buffer.push({ ordinal: lo + i, ev: items[i] });
        }
      }
      this.from = hi;
    }
  }

  async peek(): Promise<OrdinalEvent | null> {
    if (this.buffer.length === 0) await this.refill();
    return this.buffer[0] ?? null;
  }

  async next(): Promise<OrdinalEvent | null> {
    const head = await this.peek();
    if (head) this.buffer.shift();
    return head;
  }

  /** jump to `ordinal`: advance in-buffer if already buffered, else drop and refetch */
  seek(ordinal: number): void {
    if (this.buffer.length > 0 && this.buffer[this.buffer.length - 1].ordinal >= ordinal) {
      while (this.buffer.length > 0 && this.buffer[0].ordinal < ordinal) this.buffer.shift();
      return;
    }
    this.buffer = [];
    this.exhausted = false;
    this.from = Math.max(this.from, ordinal);
  }
}
