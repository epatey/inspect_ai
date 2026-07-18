// PROTOTYPE — the windowed transcript. @tanstack/react-virtual (the same core
// production's VirtualList wraps) over the estimate-then-correct RowSpace:
// placeholders render instantly, visible placeholder chunks decode on demand,
// corrections shift the row space (anchor-lock compensates when enabled).
// Sticky span breadcrumb comes from skeleton.spanStackAt — the span_begin
// events are never fetched for it.

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
} from "react";
import type { DecodeCtx } from "../data/decode";
import type { RowSpace } from "../data/rowSpace";
import type { LoadedSample } from "../data/sampleClient";
import { PlaceholderRow, RowView } from "./rowsUi";

export type JumpTarget = { ordinal: number } | "start" | "end";
export interface TranscriptHandle {
  jump(target: JumpTarget): void;
}

export const Transcript = forwardRef<
  TranscriptHandle,
  {
    sample: LoadedSample;
    rowSpace: RowSpace;
    ctx: DecodeCtx;
    onToggle: (spanId: string) => void;
    anchorLock: boolean;
  }
>(function Transcript({ sample, rowSpace, ctx, onToggle, anchorLock }, ref) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const anchorOrdinal = useRef<number | null>(null);
  const pendingJump = useRef<number | null>(null);
  const didInitialJump = useRef(false);

  const virtualizer = useVirtualizer({
    count: rowSpace.total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 30,
    overscan: 8,
  });

  // corrections: re-render, then restore the ordinal anchor (or finish a jump)
  useEffect(() => {
    return rowSpace.onChange(() => {
      const pending = pendingJump.current;
      const anchor = anchorOrdinal.current;
      force();
      requestAnimationFrame(() => {
        if (pending !== null) {
          virtualizer.scrollToIndex(rowSpace.rowIndexForOrdinal(pending), { align: "start" });
          if (rowSpace.isMaterialized(sample.stores.events.chunkIndexOf(pending))) {
            pendingJump.current = null;
          }
        } else if (anchorLock && anchor !== null) {
          virtualizer.scrollToIndex(rowSpace.rowIndexForOrdinal(anchor), { align: "start" });
        }
      });
    });
  }, [rowSpace, virtualizer, anchorLock, sample]);

  const items = virtualizer.getVirtualItems();

  // track the topmost visible ordinal (anchor + sticky breadcrumb)
  const topSlot = items.length > 0 ? rowSpace.slotAt(items[0].index) : null;
  const topOrdinal = topSlot === null ? null : topSlot.kind === "row" ? topSlot.row.ordinal : topSlot.estOrdinal;
  useEffect(() => {
    if (pendingJump.current === null) anchorOrdinal.current = topOrdinal;
  });

  // materialize any placeholder chunks in view
  useEffect(() => {
    const chunks = new Set<number>();
    for (const vi of items) {
      const slot = rowSpace.slotAt(vi.index);
      if (slot.kind === "placeholder") chunks.add(slot.chunkIdx);
    }
    chunks.forEach((c) => void rowSpace.materialize(c, ctx));
  }, [items, rowSpace, ctx]);

  const jump = (target: JumpTarget) => {
    const ordinal =
      target === "start" ? 0 : target === "end" ? sample.stores.events.count - 1 : target.ordinal;
    pendingJump.current = ordinal;
    virtualizer.scrollToIndex(Math.min(rowSpace.rowIndexForOrdinal(ordinal), rowSpace.total - 1), {
      align: target === "end" ? "end" : "start",
    });
    void rowSpace.materialize(sample.stores.events.chunkIndexOf(ordinal), ctx).then(() => {
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(rowSpace.rowIndexForOrdinal(ordinal), {
          align: target === "end" ? "end" : "start",
        });
        pendingJump.current = null;
      });
    });
  };
  useImperativeHandle(ref, () => ({ jump }));

  // last-page open path: the default open lands at the transcript's end
  useEffect(() => {
    if (didInitialJump.current || rowSpace.total === 0) return;
    didInitialJump.current = true;
    const params = new URLSearchParams(location.search);
    const ord = params.get("ord");
    jump(ord !== null ? { ordinal: Number(ord) } : "end");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSpace]);

  // sticky breadcrumb from the skeleton alone
  const stack = topOrdinal !== null ? sample.skel.spanStackAt(topOrdinal) : [];

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          padding: "4px 12px",
          borderBottom: "2px solid #dee2e6",
          background: "#fff9db",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          flexShrink: 0,
        }}
      >
        {stack.length === 0 && <span style={{ color: "#adb5bd" }}>(no enclosing span)</span>}
        {stack.map((spanIdx, i) => {
          const s = sample.skel.spans[spanIdx];
          return (
            <span key={s.id}>
              {i > 0 && <span style={{ color: "#adb5bd" }}> › </span>}
              <span
                style={{ cursor: "pointer", fontWeight: i === stack.length - 1 ? 600 : 400 }}
                onClick={() => jump({ ordinal: s.begin })}
                title={`${s.events.toLocaleString()} events`}
              >
                {s.name ?? s.type ?? s.id}
              </span>
            </span>
          );
        })}
        <span className="mono" style={{ float: "right", color: "#adb5bd", fontSize: 10 }}>
          @ord {topOrdinal?.toLocaleString() ?? "–"}
        </span>
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto" }}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {items.map((vi) => {
            const slot = rowSpace.slotAt(vi.index);
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}
              >
                {slot.kind === "row" ? (
                  <RowView row={slot.row} sample={sample} onToggle={onToggle} />
                ) : (
                  <PlaceholderRow estOrdinal={slot.estOrdinal} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
