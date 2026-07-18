// PROTOTYPE — query layer over skeleton.json: span stack at an ordinal
// (sticky headers / depth seeding with zero event reads), span-by-begin,
// collapse elision ranges.

import type { Skeleton, SkeletonSpan } from "./types";

export class SkeletonIndex {
  readonly spans: SkeletonSpan[];
  readonly childrenOf: number[][];
  readonly roots: number[];
  private byBegin = new Map<number, number>();

  constructor(readonly skeleton: Skeleton) {
    this.spans = skeleton.spans;
    this.childrenOf = this.spans.map(() => []);
    this.roots = [];
    this.spans.forEach((s, i) => {
      this.byBegin.set(s.begin, i);
      if (s.parent === null) this.roots.push(i);
      else this.childrenOf[s.parent].push(i);
    });
  }

  spanAtBegin(ordinal: number): number | undefined {
    return this.byBegin.get(ordinal);
  }

  /**
   * Structural ancestor stack (outermost first) containing `ordinal` —
   * answered entirely from extents; the span_begin events need never be
   * fetched. Interleaved-span extent overlap: first containing child wins
   * (tolerated per spec; correctness comes from span_id on fetched events).
   */
  spanStackAt(ordinal: number): number[] {
    const stack: number[] = [];
    let candidates = this.roots;
    for (;;) {
      const hit = candidates.find((i) => {
        const [lo, hi] = this.spans[i].extent;
        return lo <= ordinal && ordinal <= hi;
      });
      if (hit === undefined) return stack;
      stack.push(hit);
      candidates = this.childrenOf[hit];
    }
  }

  depthAt(ordinal: number): number {
    return this.spanStackAt(ordinal).length;
  }

  /** does an expanded span have anything to show under the current filter? */
  hasVisibleContents(spanIdx: number, visibleTypes: (t: string) => boolean): boolean {
    const s = this.spans[spanIdx];
    if (s.models > 0 && visibleTypes("model")) return true;
    if (Object.entries(s.children).some(([t, n]) => n > 0 && visibleTypes(t))) return true;
    return this.childrenOf[spanIdx].length > 0;
  }
}
