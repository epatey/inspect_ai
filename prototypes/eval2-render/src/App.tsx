// PROTOTYPE — throwaway. Answers wayfinder ticket #8: can the browser render
// paginated .eval2 samples with a windowed transcript?

import { useEffect, useMemo, useRef, useState } from "react";
import type { DecodeCtx } from "./data/decode";
import { RowSpace } from "./data/rowSpace";
import { openSample, type LoadedSample } from "./data/sampleClient";
import { Hud } from "./ui/Hud";
import { Outline } from "./ui/Outline";
import { Transcript, type TranscriptHandle } from "./ui/Transcript";

const SAMPLES: Record<string, string> = {
  "mirror-code (337k events)": "mirror-code/new/extracted/samples/ngnk_python_epoch_1",
  "ais-decoder (126 events)": "ais-decoder/new/extracted/samples/1_epoch_1",
};

export function App() {
  const [samplePath, setSamplePath] = useState(Object.values(SAMPLES)[0]);
  const [sample, setSample] = useState<LoadedSample | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [hiddenTypes, setHiddenTypes] = useState<ReadonlySet<string>>(new Set());
  const [anchorLock, setAnchorLock] = useState(true);
  const transcriptRef = useRef<TranscriptHandle>(null);

  useEffect(() => {
    let stale = false;
    setSample(null);
    setError(null);
    setCollapsed(new Set());
    openSample(samplePath).then(
      (s) => !stale && setSample(s),
      (e: unknown) => !stale && setError(String(e)),
    );
    return () => {
      stale = true;
    };
  }, [samplePath]);

  const visible = useMemo(() => {
    return (t: string) => !hiddenTypes.has(t);
  }, [hiddenTypes]);

  const rowSpace = useMemo(() => {
    if (!sample) return null;
    return new RowSpace(sample.stores.events, sample.stats, sample.skel, new Set(collapsed), visible);
  }, [sample, collapsed, visible]);

  const ctx: DecodeCtx | null = useMemo(() => {
    if (!sample) return null;
    return {
      events: sample.stores.events,
      stats: sample.stats,
      skel: sample.skel,
      isCollapsed: (id: string) => collapsed.has(id),
      visible,
    };
  }, [sample, collapsed, visible]);

  const toggleCollapse = (spanId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  };

  const eventTypes = useMemo(() => {
    if (!sample) return [];
    const all = new Set<string>();
    for (const st of sample.stats) {
      for (const t of Object.keys(st.type_counts)) all.add(t);
    }
    all.delete("span_begin");
    all.delete("span_end");
    return [...all].sort();
  }, [sample]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Hud
        sampleNames={SAMPLES}
        samplePath={samplePath}
        onSample={setSamplePath}
        rowSpace={rowSpace}
        eventTypes={eventTypes}
        hiddenTypes={hiddenTypes}
        onHiddenTypes={setHiddenTypes}
        anchorLock={anchorLock}
        onAnchorLock={setAnchorLock}
        onJump={(target) => transcriptRef.current?.jump(target)}
      />
      {error && <div style={{ padding: 16, color: "crimson" }}>{error}</div>}
      {!sample && !error && <div style={{ padding: 16 }}>loading shell + skeleton…</div>}
      {sample && rowSpace && ctx && (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <Outline
            skel={sample.skel}
            collapsed={collapsed}
            onToggle={toggleCollapse}
            onJump={(ordinal) => transcriptRef.current?.jump({ ordinal })}
          />
          <Transcript
            ref={transcriptRef}
            key={sample.path}
            sample={sample}
            rowSpace={rowSpace}
            ctx={ctx}
            onToggle={toggleCollapse}
            anchorLock={anchorLock}
          />
        </div>
      )}
    </div>
  );
}
