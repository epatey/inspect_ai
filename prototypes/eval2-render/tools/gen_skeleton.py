"""PROTOTYPE — throwaway skeleton/stats producer for extracted .eval2 samples.

Implements the ratified skeleton spec (wayfinder ticket #5) offline, since the
converter on scale-prototype predates that decision. Writes, per sample dir:

  skeleton.json      — span table + notables + sample totals (span-proportional)
  events/stats.json  — per-chunk {start, type_counts, first/last type+span_id}

Usage: python3 gen_skeleton.py SAMPLE_DIR [SAMPLE_DIR ...]
"""

import bisect
import json
import sys
from pathlib import Path

NOTABLE_TYPES = ("score", "error", "sample_limit", "compaction", "checkpoint")
NOTABLE_CAP = 1000  # per-type first-N cap (writer-policy knob)
LEAF_TOOL_ESCAPE_EVENTS = 1000  # ~1 chunk: monster leaf tool spans stay


class Span:
    def __init__(self, span_id, parent, name, type_, begin, t0, w0):
        self.id = span_id
        self.parent = parent  # Span | None
        self.name = name
        self.type = type_
        self.begin = begin
        self.last = begin  # extent end, updated as descendants stream
        self.t = [t0, t0]
        self.working = [w0, w0]
        self.events = 0  # descendant count (inclusive of nested spans)
        self.models = 0
        self.children = {}  # direct-child event-type counts (non-span events)
        self.child_spans = []  # direct-child Spans, begin order
        self.notables = []  # (index, type, extra) owned by this span
        self.excluded = False


def load_chunks(events_dir: Path):
    return sorted(events_dir.glob("*.json"), key=lambda p: int(p.stem))


def generate(sample_dir: Path) -> None:
    events_dir = sample_dir / "events"
    chunk_files = [p for p in load_chunks(events_dir) if p.name != "stats.json"]

    spans_by_id: dict[str, Span] = {}
    all_spans: list[Span] = []
    stack: list[Span] = []
    model_indexes: list[int] = []
    stats = []
    total_events = 0
    idx = -1

    for chunk in chunk_files:
        items = json.loads(chunk.read_text())
        type_counts: dict[str, int] = {}
        first = last = None
        for ev in items:
            idx += 1
            etype = ev["event"]
            type_counts[etype] = type_counts.get(etype, 0) + 1
            desc = {"type": etype, "span_id": ev.get("span_id")}
            first = first or desc
            last = desc

            for s in stack:
                s.events += 1
                s.last = idx
                s.t[1] = ev.get("timestamp") or s.t[1]
                if ev.get("working_start") is not None:
                    s.working[1] = float(ev["working_start"])

            if etype == "span_begin":
                parent = spans_by_id.get(ev.get("parent_id")) or (
                    stack[-1] if stack else None
                )
                span = Span(
                    ev["id"],
                    parent,
                    ev.get("name"),
                    ev.get("type"),
                    idx,
                    ev.get("timestamp"),
                    float(ev["working_start"]) if ev.get("working_start") else None,
                )
                spans_by_id[span.id] = span
                all_spans.append(span)
                if parent:
                    parent.child_spans.append(span)
                stack.append(span)
            elif etype == "span_end":
                span = spans_by_id.get(ev["id"])
                if span and span in stack:
                    stack.remove(span)
            else:
                owner = spans_by_id.get(ev.get("span_id"))
                if owner:
                    owner.children[etype] = owner.children.get(etype, 0) + 1
                if etype == "model":
                    model_indexes.append(idx)
                    for s in stack:
                        s.models += 1
                if etype in NOTABLE_TYPES and owner:
                    extra = {}
                    if etype == "score" and isinstance(ev.get("score"), dict):
                        extra = {"scorer": ev.get("scorer") or ev.get("name")}
                    owner.notables.append((idx, etype, extra))

        stats.append(
            {
                "start": int(chunk.stem),
                "type_counts": type_counts,
                "first": first,
                "last": last,
            }
        )
    total_events = idx + 1

    # Leaf-tool exclusion (+ size escape hatch): fold structureless tool spans
    # into their parent; their notables reattach to the nearest surviving span.
    for span in all_spans:
        span.excluded = (
            span.type == "tool"
            and not span.child_spans
            and span.models == 0
            and not span.notables
            and span.events < LEAF_TOOL_ESCAPE_EVENTS
        )
    survivors = [s for s in all_spans if not s.excluded]

    def surviving(span: Span | None) -> Span | None:
        while span is not None and span.excluded:
            span = span.parent
        return span

    index_of = {id(s): i for i, s in enumerate(survivors)}

    # gap_models: items = direct-child *surviving* spans + owned notables,
    # merged in sequence order; gap k = model events (bisect over the global
    # model-index list) strictly between item k-1 and item k. Excluded spans
    # contain no models by construction, so index-range counting is exact
    # (modulo interleaved-span overlap, tolerated per spec).
    def gap_models(span: Span) -> tuple[list[int], list[dict]]:
        items = sorted(
            [(c.begin, "span", c) for c in span.child_spans if not c.excluded]
            + [(i, "notable", (i, t, x)) for (i, t, x) in span.notables],
            key=lambda it: it[0],
        )
        bounds = [span.begin] + [it[0] for it in items] + [span.last + 1]
        gaps = [
            bisect.bisect_left(model_indexes, hi) - bisect.bisect_left(model_indexes, lo)
            for lo, hi in zip(bounds[:-1], bounds[1:])
        ]
        # models inside item extents were counted into the enclosing gap ranges;
        # subtract each item-span's own descendant models from the gap after it
        for k, (_, kind, payload) in enumerate(items):
            if kind == "span":
                gaps[k + 1] -= payload.models
        return gaps, items

    span_rows = []
    notables_out = []
    notable_counts: dict[str, int] = {}
    overflow: dict[str, bool] = {}
    for span in survivors:
        gaps, items = gap_models(span)
        row = {
            "id": span.id,
            "parent": index_of.get(id(surviving(span.parent))),
            "name": span.name,
            "type": span.type,
            "begin": span.begin,
            "extent": [span.begin, span.last],
            "t": span.t,
            "working": span.working,
            "events": span.events,
            "models": span.models,
            "gap_models": gaps,
            "children": span.children,
        }
        span_rows.append(row)
        for i, t, extra in span.notables:
            n = notable_counts.get(t, 0)
            if n >= NOTABLE_CAP:
                overflow[t] = True
                continue
            notable_counts[t] = n + 1
            notables_out.append({"i": i, "span": index_of[id(span)], "type": t, **extra})

    skeleton = {
        "version": 1,
        "counts": {"events": total_events, "models": len(model_indexes)},
        "spans": span_rows,
        "notables": sorted(notables_out, key=lambda n: n["i"]),
        **({"notables_overflow": overflow} if overflow else {}),
    }
    (sample_dir / "skeleton.json").write_text(json.dumps(skeleton))
    (events_dir / "stats.json").write_text(json.dumps(stats))
    print(
        f"{sample_dir.name}: events={total_events} spans={len(all_spans)} "
        f"kept={len(survivors)} (excluded {len(all_spans) - len(survivors)} leaf tool) "
        f"notables={len(notables_out)} chunks={len(stats)}"
    )


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        generate(Path(arg))
