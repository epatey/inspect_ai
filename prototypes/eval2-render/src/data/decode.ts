// PROTOTYPE — Layer 2 of the view-row pagination draft: the decode walk.
// Produces view rows by walking surviving events; the skeleton lets the walk
// seek past collapsed/filter-empty spans (zero reads) and chunk stats let
// sandbox runs coalesce without reading uniform interior chunks.

import type { ChunkStore } from "./chunks";
import { FilteredCursor } from "./cursor";
import type { SkeletonIndex } from "./skeletonIndex";
import type { ChunkStats, EventLite, SkeletonSpan } from "./types";

export type ViewRow =
  | { kind: "span"; ordinal: number; depth: number; spanIdx: number; span: SkeletonSpan; collapsed: boolean }
  | { kind: "event"; ordinal: number; depth: number; ev: EventLite }
  | { kind: "run"; ordinal: number; depth: number; runType: string; count: number; extent: [number, number]; sample: EventLite };

const RUN_TYPES = new Set(["sandbox"]);

export interface DecodeCtx {
  events: ChunkStore<EventLite>;
  stats: ChunkStats[];
  skel: SkeletonIndex;
  isCollapsed: (spanId: string) => boolean;
  /** user event-type filter (structure types are force-included separately) */
  visible: (type: string) => boolean;
}

/**
 * Decode view rows for ordinals [startOrd, endOrd). Rows whose decode unit
 * *starts* in-range are emitted even if (via seeks or runs) they extend past
 * endOrd. `headRunContinues` — the caller detected (from the previous chunk's
 * stats) that startOrd begins mid-run; leading run events are consumed rowless.
 */
export async function decodeRange(
  ctx: DecodeCtx,
  startOrd: number,
  endOrd: number,
  headRunContinues: boolean,
): Promise<ViewRow[]> {
  const survives = (t: string) =>
    t === "span_begin" || t === "span_end" || RUN_TYPES.has(t) || ctx.visible(t);
  const cursor = new FilteredCursor(ctx.events, ctx.stats, startOrd, survives);
  const rows: ViewRow[] = [];
  const spanIds = new Set(ctx.skel.spans.map((s) => s.id));

  if (headRunContinues) {
    const head = await cursor.peek();
    if (head && RUN_TYPES.has(head.ev.event)) {
      await takeRun(cursor, head); // consumed, attributed to the prior chunk
    }
  }

  for (;;) {
    const item = await cursor.peek();
    if (!item || item.ordinal >= endOrd) break;
    const { ordinal, ev } = item;

    if (ev.event === "span_begin") {
      const spanIdx = ctx.skel.spanAtBegin(ordinal);
      if (spanIdx === undefined) {
        await cursor.next(); // excluded leaf-tool span: no row, contents inline
        continue;
      }
      const span = ctx.skel.spans[spanIdx];
      const depth = ctx.skel.spanStackAt(ordinal).length - 1;
      if (!ctx.skel.hasVisibleContents(spanIdx, ctx.visible)) {
        cursor.seek(span.extent[1] + 1); // filterEmpty: free
      } else if (ctx.isCollapsed(span.id)) {
        rows.push({ kind: "span", ordinal, depth, spanIdx, span, collapsed: true });
        cursor.seek(span.extent[1] + 1); // collapsed regions are free
      } else {
        rows.push({ kind: "span", ordinal, depth, spanIdx, span, collapsed: false });
        await cursor.next();
      }
    } else if (ev.event === "span_end") {
      await cursor.next();
    } else if (RUN_TYPES.has(ev.event)) {
      const depth = rowDepth(ctx, ordinal, ev, spanIds);
      const run = await takeRun(cursor, item);
      if (ctx.visible(ev.event)) {
        rows.push({ kind: "run", ordinal, depth, runType: ev.event, count: run.count, extent: [ordinal, run.last], sample: ev });
      }
    } else {
      rows.push({ kind: "event", ordinal, depth: rowDepth(ctx, ordinal, ev, spanIds), ev });
      await cursor.next();
    }
  }
  return rows;
}

function rowDepth(ctx: DecodeCtx, ordinal: number, ev: EventLite, structuralIds: Set<string>): number {
  const structural = ctx.skel.spanStackAt(ordinal).length;
  // contents of excluded leaf-tool spans indent one extra level
  return structural + (ev.span_id && !structuralIds.has(ev.span_id) ? 1 : 0);
}

/**
 * Consume a maximal run of consecutive same-type same-span events. Fast path:
 * a following chunk whose stats say "uniform run type, same span at both
 * edges" is counted from stats and skipped unread — only mixed edge chunks
 * are fetched (reads ∝ rows emitted).
 */
async function takeRun(
  cursor: FilteredCursor,
  first: { ordinal: number; ev: EventLite },
): Promise<{ count: number; last: number }> {
  const runType = first.ev.event;
  const spanId = first.ev.span_id ?? null;
  let count = 0;
  let last = first.ordinal;

  for (;;) {
    const item = await cursor.peek();
    if (!item || item.ev.event !== runType || (item.ev.span_id ?? null) !== spanId) break;
    count += 1;
    last = item.ordinal;
    await cursor.next();

    // at a chunk boundary, swallow uniform chunks from stats alone
    let chunkIdx = cursor.chunkIndexOf(last) + 1;
    for (;;) {
      const st = cursor.statsFor(chunkIdx);
      const [lo, hi] = cursor.chunkBounds(chunkIdx) ?? [NaN, NaN];
      if (
        !st ||
        last !== lo - 1 ||
        Object.keys(st.type_counts).some((t) => t !== runType) ||
        st.first?.span_id !== spanId ||
        st.last?.span_id !== spanId
      ) {
        break;
      }
      count += st.type_counts[runType] ?? 0;
      last = hi - 1;
      cursor.seek(hi);
      chunkIdx += 1;
    }
  }
  return { count, last };
}
