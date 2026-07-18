// PROTOTYPE — the outline, synthesized ENTIRELY from skeleton.json: span rows,
// "N turns" gap rows (gap_models), notable rows. Zero event chunk reads —
// the #5 consumer contract, demonstrated.

import { Fragment, useMemo } from "react";
import type { SkeletonIndex } from "../data/skeletonIndex";
import type { Notable } from "../data/types";

interface OutlineRow {
  kind: "span" | "turns" | "notable";
  depth: number;
  label: string;
  anchor: number; // ordinal to jump to
  spanId?: string;
  collapsed?: boolean;
}

function buildRows(skel: SkeletonIndex, collapsed: ReadonlySet<string>): OutlineRow[] {
  const notablesBySpan = new Map<number, Notable[]>();
  for (const n of skel.skeleton.notables) {
    const list = notablesBySpan.get(n.span) ?? [];
    list.push(n);
    notablesBySpan.set(n.span, list);
  }

  const rows: OutlineRow[] = [];
  const emitSpan = (spanIdx: number, depth: number) => {
    const s = skel.spans[spanIdx];
    const isCollapsed = collapsed.has(s.id);
    rows.push({
      kind: "span",
      depth,
      label: `${s.name ?? s.type ?? s.id}`,
      anchor: s.begin,
      spanId: s.id,
      collapsed: isCollapsed,
    });
    if (isCollapsed) return;

    // items = direct-child structural spans + owned notables, sequence order;
    // one "N turns" row per nonzero gap_models entry
    const items = [
      ...skel.childrenOf[spanIdx].map((ci) => ({ pos: skel.spans[ci].begin, spanIdx: ci, notable: undefined as Notable | undefined })),
      ...(notablesBySpan.get(spanIdx) ?? []).map((n) => ({ pos: n.i, spanIdx: -1, notable: n })),
    ].sort((a, b) => a.pos - b.pos);

    const gaps = s.gap_models;
    const emitGap = (k: number, anchor: number) => {
      const n = gaps[k] ?? 0;
      if (n > 0) rows.push({ kind: "turns", depth: depth + 1, label: `${n.toLocaleString()} turns`, anchor });
    };
    emitGap(0, s.begin + 1);
    items.forEach((item, k) => {
      if (item.notable) {
        rows.push({ kind: "notable", depth: depth + 1, label: item.notable.type, anchor: item.notable.i });
      } else {
        emitSpan(item.spanIdx, depth + 1);
      }
      emitGap(k + 1, item.notable ? item.notable.i + 1 : skel.spans[item.spanIdx].extent[1] + 1);
    });
  };
  skel.roots.forEach((r) => emitSpan(r, 0));
  return rows;
}

export function Outline({
  skel,
  collapsed,
  onToggle,
  onJump,
}: {
  skel: SkeletonIndex;
  collapsed: ReadonlySet<string>;
  onToggle: (spanId: string) => void;
  onJump: (ordinal: number) => void;
}) {
  const rows = useMemo(() => buildRows(skel, collapsed), [skel, collapsed]);
  return (
    <div style={{ width: 300, flexShrink: 0, overflow: "auto", borderRight: "1px solid #dee2e6", background: "#f8f9fa" }}>
      <div style={{ padding: "6px 10px", fontWeight: 600, borderBottom: "1px solid #dee2e6" }}>
        Outline <span style={{ fontWeight: 400, color: "#868e96" }}>({rows.length} rows, 0 event reads)</span>
      </div>
      {rows.map((r, i) => (
        <Fragment key={i}>
          <div
            style={{
              padding: `2px 6px 2px ${8 + r.depth * 14}px`,
              cursor: "pointer",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: r.kind === "turns" ? "#4c6ef5" : r.kind === "notable" ? "#37b24d" : "inherit",
              fontWeight: r.kind === "span" ? 600 : 400,
            }}
            onClick={() => onJump(r.anchor)}
          >
            {r.kind === "span" && r.spanId !== undefined && (
              <span
                style={{ marginRight: 4 }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (r.spanId !== undefined) onToggle(r.spanId);
                }}
              >
                {r.collapsed ? "▸" : "▾"}
              </span>
            )}
            {r.label}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
