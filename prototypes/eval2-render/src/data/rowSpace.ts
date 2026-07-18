// PROTOTYPE — the estimate-then-correct global view-row index space (the
// framing doc's "Consequences" landing). Row accounting is per event chunk:
// a chunk's row count is estimated from its stats (filter-aware, minus
// collapse elision, runs guessed), then corrected to exact when the chunk's
// window decodes. The virtualizer sees prefix-summed totals; corrections are
// O(#chunks) and bounded per chunk.

import type { ChunkStore } from "./chunks";
import { decodeRange, type DecodeCtx, type ViewRow } from "./decode";
import type { SkeletonIndex } from "./skeletonIndex";
import type { ChunkStats, EventLite } from "./types";

const STRUCTURAL = new Set(["span_begin", "span_end"]);
const RUN_TYPES = new Set(["sandbox"]);
const EST_RUN_LEN = 6;

export type RowSlot =
  | { kind: "row"; row: ViewRow; globalIndex: number }
  | { kind: "placeholder"; chunkIdx: number; estOrdinal: number; globalIndex: number };

export class RowSpace {
  readonly chunkRows: number[];
  readonly exact: boolean[];
  private materializedRows = new Map<number, ViewRow[]>();
  private inflight = new Map<number, Promise<void>>();
  private prefix: number[] = [];
  version = 0;
  private listeners = new Set<() => void>();

  /** merged elided ordinal ranges [lo, hi] (collapsed span interiors) */
  private elision: [number, number][] = [];

  constructor(
    private events: ChunkStore<EventLite>,
    private stats: ChunkStats[],
    private skel: SkeletonIndex,
    private collapsed: Set<string>,
    private visible: (t: string) => boolean,
  ) {
    // elision: interiors of collapsed spans + full extents of filter-empty spans
    const ranges: [number, number][] = [];
    skel.spans.forEach((s, i) => {
      if (!skel.hasVisibleContents(i, visible)) ranges.push([s.begin, s.extent[1]]);
      else if (collapsed.has(s.id)) ranges.push([s.begin + 1, s.extent[1]]);
    });
    ranges.sort((a, b) => a[0] - b[0]);
    for (const r of ranges) {
      const last = this.elision[this.elision.length - 1];
      if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
      else this.elision.push([...r]);
    }

    this.chunkRows = this.stats.map((st, c) => this.estimateChunk(st, c));
    this.exact = this.stats.map((_, c) => this.chunkRows[c] === 0 && this.fullyElided(c));
    this.recompute();
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  get total(): number {
    return this.prefix[this.prefix.length - 1] ?? 0;
  }

  private chunkBounds(c: number): [number, number] {
    return [this.events.starts[c], this.events.ends[c]];
  }

  private elidedOverlap(lo: number, hi: number): number {
    let covered = 0;
    for (const [a, b] of this.elision) {
      const s = Math.max(lo, a);
      const e = Math.min(hi - 1, b);
      if (s <= e) covered += e - s + 1;
    }
    return covered;
  }

  private fullyElided(c: number): boolean {
    const [lo, hi] = this.chunkBounds(c);
    return this.elidedOverlap(lo, hi) >= hi - lo;
  }

  private estimateChunk(st: ChunkStats, c: number): number {
    const [lo, hi] = this.chunkBounds(c);
    const visibleFrac = 1 - this.elidedOverlap(lo, hi) / (hi - lo);
    if (visibleFrac <= 0) return 0;
    let typeRows = 0;
    let runRows = 0;
    for (const [t, n] of Object.entries(st.type_counts)) {
      if (STRUCTURAL.has(t) || !this.visible(t)) continue;
      if (RUN_TYPES.has(t)) runRows += Math.max(1, Math.round(n / EST_RUN_LEN));
      else typeRows += n;
    }
    // structural span rows are exact: spans beginning in this chunk, begin not elided
    const spanRows = this.skel.spans.filter(
      (s, i) =>
        s.begin >= lo &&
        s.begin < hi &&
        this.elidedOverlap(s.begin, s.begin + 1) === 0 &&
        this.skel.hasVisibleContents(i, this.visible),
    ).length;
    return Math.round((typeRows + runRows) * visibleFrac) + spanRows;
  }

  private recompute() {
    this.prefix = [0];
    for (const n of this.chunkRows) this.prefix.push(this.prefix[this.prefix.length - 1] + n);
    this.version += 1;
    this.listeners.forEach((fn) => fn());
  }

  slotAt(globalIndex: number): RowSlot {
    // binary search: greatest c with prefix[c] <= globalIndex
    let lo = 0;
    let hi = this.chunkRows.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.prefix[mid] <= globalIndex) lo = mid;
      else hi = mid - 1;
    }
    const offset = globalIndex - this.prefix[lo];
    const rows = this.materializedRows.get(lo);
    if (rows && offset < rows.length) return { kind: "row", row: rows[offset], globalIndex };
    const [clo, chi] = this.chunkBounds(lo);
    const est = Math.max(this.chunkRows[lo], 1);
    const estOrdinal = Math.min(chi - 1, clo + Math.floor(((offset + 0.5) / est) * (chi - clo)));
    return { kind: "placeholder", chunkIdx: lo, estOrdinal, globalIndex };
  }

  rowIndexForOrdinal(ordinal: number): number {
    const c = this.events.chunkIndexOf(Math.min(ordinal, this.events.count - 1));
    const rows = this.materializedRows.get(c);
    if (rows) {
      const i = rows.findIndex((r) => r.ordinal >= ordinal);
      return this.prefix[c] + (i === -1 ? Math.max(rows.length - 1, 0) : i);
    }
    const [lo, hi] = this.chunkBounds(c);
    return this.prefix[c] + Math.floor(((ordinal - lo) / (hi - lo)) * this.chunkRows[c]);
  }

  isMaterialized(chunkIdx: number): boolean {
    return this.materializedRows.has(chunkIdx);
  }

  /** decode a chunk's window and correct its row count; idempotent */
  materialize(chunkIdx: number, ctx: DecodeCtx): Promise<void> {
    if (this.materializedRows.has(chunkIdx)) return Promise.resolve();
    let p = this.inflight.get(chunkIdx);
    if (p) return p;
    p = this.doMaterialize(chunkIdx, ctx).finally(() => this.inflight.delete(chunkIdx));
    this.inflight.set(chunkIdx, p);
    return p;
  }

  private async doMaterialize(chunkIdx: number, ctx: DecodeCtx): Promise<void> {
    const [lo, hi] = this.chunkBounds(chunkIdx);
    // decode starts at the first non-elided ordinal in the chunk
    let start = lo;
    for (const [a, b] of this.elision) {
      if (a <= start && start <= b) start = b + 1;
    }
    let rows: ViewRow[] = [];
    if (start < hi) {
      const prev = this.stats[chunkIdx - 1];
      const cur = this.stats[chunkIdx];
      const headRunContinues =
        start === lo &&
        !!prev?.last &&
        !!cur?.first &&
        RUN_TYPES.has(prev.last.type) &&
        prev.last.type === cur.first.type &&
        prev.last.span_id === cur.first.span_id;
      rows = await decodeRange(ctx, start, hi, headRunContinues);
    }
    this.materializedRows.set(chunkIdx, rows);
    this.chunkRows[chunkIdx] = rows.length;
    this.exact[chunkIdx] = true;
    this.recompute();
  }

  get materializedCount(): number {
    return this.materializedRows.size;
  }
}
