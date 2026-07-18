// PROTOTYPE — controls + the read-cost meter (the "reads ∝ rows emitted"
// invariant made visible).

import { useEffect, useReducer, useState } from "react";
import { getLatency, onStatsChange, resetStats, setLatency, stats } from "../data/fetchLog";
import type { RowSpace } from "../data/rowSpace";
import type { JumpTarget } from "./Transcript";

export function Hud({
  sampleNames,
  samplePath,
  onSample,
  rowSpace,
  eventTypes,
  hiddenTypes,
  onHiddenTypes,
  anchorLock,
  onAnchorLock,
  onJump,
}: {
  sampleNames: Record<string, string>;
  samplePath: string;
  onSample: (path: string) => void;
  rowSpace: RowSpace | null;
  eventTypes: string[];
  hiddenTypes: ReadonlySet<string>;
  onHiddenTypes: (s: ReadonlySet<string>) => void;
  anchorLock: boolean;
  onAnchorLock: (b: boolean) => void;
  onJump: (t: JumpTarget) => void;
}) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [ordInput, setOrdInput] = useState("");
  useEffect(() => onStatsChange(force), []);
  useEffect(() => (rowSpace ? rowSpace.onChange(force) : undefined), [rowSpace]);

  const toggleType = (t: string) => {
    const next = new Set(hiddenTypes);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    onHiddenTypes(next);
  };

  return (
    <div style={{ borderBottom: "2px solid #495057", padding: "6px 12px", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", background: "#212529", color: "#dee2e6" }}>
      <b style={{ color: "#ffd43b" }}>eval2 PROTOTYPE</b>
      <select value={samplePath} onChange={(e) => onSample(e.target.value)}>
        {Object.entries(sampleNames).map(([name, path]) => (
          <option key={path} value={path}>{name}</option>
        ))}
      </select>
      <span>
        <button onClick={() => onJump("start")}>⇱ start</button>
        <button onClick={() => onJump("end")}>⇲ end</button>
        <input
          placeholder="ordinal"
          value={ordInput}
          onChange={(e) => setOrdInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ordInput && onJump({ ordinal: Number(ordInput) })}
          style={{ width: 80 }}
          className="mono"
        />
      </span>
      <label>
        latency{" "}
        <select defaultValue={getLatency()} onChange={(e) => setLatency(Number(e.target.value))}>
          <option value={0}>0ms</option>
          <option value={100}>100ms</option>
          <option value={300}>300ms</option>
          <option value={1000}>1s</option>
        </select>
      </label>
      <label>
        <input type="checkbox" checked={anchorLock} onChange={(e) => onAnchorLock(e.target.checked)} /> anchor-lock
      </label>
      <details>
        <summary style={{ cursor: "pointer" }}>filter ({eventTypes.length - hiddenTypes.size}/{eventTypes.length})</summary>
        <div style={{ position: "absolute", zIndex: 10, background: "#343a40", padding: 8, borderRadius: 4 }}>
          {eventTypes.map((t) => (
            <label key={t} style={{ display: "block" }}>
              <input type="checkbox" checked={!hiddenTypes.has(t)} onChange={() => toggleType(t)} /> {t}
            </label>
          ))}
        </div>
      </details>
      <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "#8ce99a" }}>
        {stats.requests} req ({stats.inflight} live) · {(stats.bytes / 1024 / 1024).toFixed(1)}MB ·{" "}
        {Object.entries(stats.bySequence).map(([k, v]) => `${k}:${v}`).join(" ")}
        {rowSpace && (
          <>
            {" "}· rows≈{rowSpace.total.toLocaleString()} · decoded {rowSpace.materializedCount}/{rowSpace.chunkRows.length} chunks
          </>
        )}
        <button style={{ marginLeft: 8 }} onClick={resetStats}>reset</button>
      </span>
    </div>
  );
}
