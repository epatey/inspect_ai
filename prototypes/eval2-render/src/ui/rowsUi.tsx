// PROTOTYPE — row renderers. Deliberately crude (badge + snippet): the
// question is windowing/decode mechanics, not event presentation fidelity.

import { useEffect, useState, type CSSProperties } from "react";
import type { LoadedSample } from "../data/sampleClient";
import type { ViewRow } from "../data/decode";
import type { EventLite, MessageLite } from "../data/types";

const BADGE_COLORS: Record<string, string> = {
  model: "#4c6ef5",
  tool: "#f08c00",
  sandbox: "#868e96",
  logger: "#adb5bd",
  score: "#37b24d",
  store: "#b197fc",
  state: "#b197fc",
  compaction: "#e64980",
  sample_limit: "#e03131",
  sample_init: "#15aabf",
  info: "#74b816",
};

export const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const p = part as Record<string, unknown>;
          if (typeof p.text === "string") return p.text;
          if (typeof p.reasoning === "string") return p.reasoning;
          return `[${String(p.type ?? "part")}]`;
        }
        return "";
      })
      .join(" ");
  }
  if (content == null) return "";
  return JSON.stringify(content);
};

const snippet = (ev: EventLite): string => {
  switch (ev.event) {
    case "model": {
      const out = ev.output as Record<string, unknown> | undefined;
      const choices = out?.choices;
      const first = Array.isArray(choices) ? (choices[0] as Record<string, unknown>) : undefined;
      const msg = first?.message as Record<string, unknown> | undefined;
      return `${String(ev.model ?? "")} → ${textOf(msg?.content).slice(0, 160)}`;
    }
    case "tool":
      return `${String(ev.function ?? "")}(${JSON.stringify(ev.arguments ?? {}).slice(0, 120)})`;
    case "logger": {
      const m = ev.message as Record<string, unknown> | undefined;
      return String(m?.message ?? "").slice(0, 160);
    }
    case "score": {
      const s = ev.score as Record<string, unknown> | undefined;
      return `value=${JSON.stringify(s?.value)}`;
    }
    default: {
      const { event: _e, span_id: _s, uuid: _u, timestamp: _t, ...rest } = ev;
      return JSON.stringify(rest).slice(0, 160);
    }
  }
};

const Badge = ({ type }: { type: string }) => (
  <span
    className="mono"
    style={{
      background: BADGE_COLORS[type] ?? "#495057",
      color: "white",
      borderRadius: 3,
      padding: "1px 6px",
      fontSize: 10,
      marginRight: 8,
      flexShrink: 0,
    }}
  >
    {type}
  </span>
);

export function RowView({
  row,
  sample,
  onToggle,
}: {
  row: ViewRow;
  sample: LoadedSample;
  onToggle: (spanId: string) => void;
}) {
  const pad = 12 + row.depth * 18;
  const base: CSSProperties = {
    display: "flex",
    alignItems: "baseline",
    padding: `4px 8px 4px ${pad}px`,
    borderBottom: "1px solid #f1f3f5",
    overflow: "hidden",
  };
  const ord = (
    <span className="mono" style={{ color: "#adb5bd", fontSize: 10, marginRight: 8, flexShrink: 0, width: 60 }}>
      {row.ordinal}
    </span>
  );

  if (row.kind === "span") {
    return (
      <div style={{ ...base, cursor: "pointer", background: "#f8f9fa", fontWeight: 600 }} onClick={() => onToggle(row.span.id)}>
        {ord}
        <span style={{ marginRight: 6 }}>{row.collapsed ? "▸" : "▾"}</span>
        <span>{row.span.name ?? row.span.id}</span>
        <span style={{ color: "#868e96", fontWeight: 400, marginLeft: 8 }}>
          {row.span.type} · {row.span.events.toLocaleString()} events · {row.span.models.toLocaleString()} turns
        </span>
      </div>
    );
  }
  if (row.kind === "run") {
    return (
      <div style={{ ...base, color: "#868e96" }}>
        {ord}
        <Badge type={row.runType} />
        <span>
          ⟨{row.count.toLocaleString()} {row.runType} events · ordinals {row.extent[0].toLocaleString()}–{row.extent[1].toLocaleString()}⟩
        </span>
      </div>
    );
  }
  const ev = row.ev;
  return (
    <div style={base}>
      {ord}
      <Badge type={ev.event} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <span style={{ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", display: "block" }}>{snippet(ev)}</span>
        {ev.event === "model" && <ModelMessages ev={ev} sample={sample} />}
      </div>
    </div>
  );
}

export const PlaceholderRow = ({ estOrdinal }: { estOrdinal: number }) => (
  <div
    style={{
      padding: "4px 8px",
      borderBottom: "1px solid #f1f3f5",
      color: "#ced4da",
      background: "repeating-linear-gradient(90deg,#f8f9fa,#f1f3f5 40px,#f8f9fa 80px)",
    }}
    className="mono"
  >
    … ~{estOrdinal.toLocaleString()}
  </div>
);

/**
 * Confounder 1 demo: the frame (message count) renders instantly from the
 * range refs; bodies hydrate lazily on expand, ceil(window/chunk) fetches.
 */
function ModelMessages({ ev, sample }: { ev: EventLite; sample: LoadedSample }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<{ msg: MessageLite; resolved: string }[] | null>(null);
  const refs = ev.input_refs ?? [];
  const total = refs.reduce((n, [a, b]) => n + (b - a), 0);
  const SHOW = 12;

  useEffect(() => {
    if (!open || msgs !== null) return;
    let stale = false;
    (async () => {
      const picked: MessageLite[] = [];
      // hydrate the *tail* of the conversation — the interesting end
      for (const [a, b] of [...refs].reverse()) {
        if (picked.length >= SHOW) break;
        const lo = Math.max(a, b - (SHOW - picked.length));
        const batch = await sample.stores.messages.getRange(lo, b);
        picked.unshift(...(batch as MessageLite[]));
      }
      const resolved = await Promise.all(
        picked.map(async (m) => {
          let text = textOf(m.content).slice(0, 400);
          const refMatches = [...text.matchAll(/attachment:\/\/(\d+)/g)].slice(0, 3);
          for (const match of refMatches) {
            const [att] = await sample.stores.attachments.getRange(Number(match[1]), Number(match[1]) + 1);
            if (typeof att === "string") text = text.replace(match[0], att.slice(0, 300));
          }
          return { msg: m, resolved: text.slice(0, 400) };
        }),
      );
      if (!stale) setMsgs(resolved);
    })();
    return () => {
      stale = true;
    };
  }, [open, msgs, refs, sample]);

  if (total === 0) return null;
  return (
    <div style={{ fontSize: 11, color: "#868e96" }}>
      <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
        {open ? "▾" : "▸"} input: {total.toLocaleString()} messages (ranges {JSON.stringify(refs).slice(0, 60)})
      </span>
      {open && msgs === null && <div>hydrating tail…</div>}
      {open && msgs && (
        <div style={{ borderLeft: "2px solid #dee2e6", marginTop: 4, paddingLeft: 8 }}>
          {total > SHOW && <div>… {String(total - SHOW)} earlier messages not fetched …</div>}
          {msgs.map((m, i) => (
            <div key={i} style={{ margin: "2px 0" }}>
              <b>{m.msg.role}:</b> {m.resolved}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
