# Prior art: how large-trace viewers page millions of events

Research for [epatey/inspect_ai#2](https://github.com/epatey/inspect_ai/issues/2), part of the
"arbitrarily large samples in the viewer" wayfinder ([#1](https://github.com/epatey/inspect_ai/issues/1)).

**Question**: How do mature large-trace viewers (Perfetto/chrome-tracing, Jaeger/OTel UIs,
LLM-observability tools) present millions of events without loading them all in memory, and which of
their patterns transfer to inspect's constraints — serverless HTTP range reads over static,
append-written zip logs?

Sources are primary (official docs, source code, design docs, first-party engineering blogs), cited inline.

---

## Survey

### Perfetto (and legacy chrome://tracing)

**Data layout.** A Perfetto trace is a linear sequence of self-delimiting protobuf `TracePacket`s;
packets from one writer sequence are in-order, and cross-writer ordering is reconstructed later from
timestamps ([TracePacket reference](https://perfetto.dev/docs/reference/trace-packet-proto)).
**String interning is in the wire format**: per-sequence `interned_data` dictionaries are emitted
incrementally, with `incremental_state_cleared` markers telling readers when to reset interning state
(needed because ring buffers can drop the packets that defined a dictionary) — so decodability
survives losing arbitrary prefixes. The legacy Trace Event Format is a JSON event array whose
trailing `]` is optional — deliberately append/truncation-tolerant — but repeats every field name and
string per event, which Perfetto's docs cite as why JSON traces get huge and slow
([TEF spec](https://docs.google.com/document/d/1CvAClvFfyA5R-PhYUmn5OOQtYMH4h6I0nSsKchNAySU),
[other formats](https://perfetto.dev/docs/getting-started/other-formats)).

**Load-time precomputation.** `trace_processor` streams the file through a chunked reader, a
timestamp merge-sorter, and into purpose-built columnar in-memory tables with a global `StringPool`
(4-byte interned IDs in tables); SQLite is only the query planner over virtual tables
([architecture](https://perfetto.dev/docs/design-docs/trace-processor-architecture),
[string_pool.h](https://github.com/google/perfetto/blob/master/src/trace_processor/containers/string_pool.h)).
The whole trace *is* in memory — but in the engine (WASM in-browser up to ~2 GB, or a native
`trace_processor --httpd` accelerator beyond that), never in the renderer
([large traces](https://perfetto.dev/docs/visualization/large-traces)).

**UI windowing.** Tracks query only the visible time range at a **resolution derived from pixel
width**, caching a superset for panning
([base_slice_track.ts](https://github.com/google/perfetto/blob/master/ui/src/components/tracks/base_slice_track.ts)).
Queries go through a **mipmap operator** — `__intrinsic_slice_mipmap(start, end, resolution)` returns
one max-duration slice per (depth, pixel-bucket), so O(visible buckets) rows cross to the renderer,
never O(events)
([slice_mipmap_operator.cc](https://github.com/google/perfetto/blob/master/src/trace_processor/perfetto_sql/intrinsics/operators/slice_mipmap_operator.cc)).
Results stream back in pipelined columnar batches. The minimap is ~100 buckets computed by SQL
aggregation over the full sorted table at load — cheap only because the engine holds sorted columnar
data ([ui source](https://github.com/google/perfetto/tree/master/ui/src)).

**Contrast**: catapult trace-viewer imported the entire JSON into the renderer — exactly the wall
Perfetto was built to break.

### Jaeger / Grafana Tempo / Honeycomb (OTel ecosystem)

**Tempo's block format is the "static files + sidecar index" archetype.** A block in object storage
is `meta.json` + a **bloom filter** (trace-ID lookups) + an **index mapping trace IDs to Parquet row
groups** + `data.parquet`
([block format](https://grafana.com/docs/tempo/latest/reference-tempo-architecture/block-format/)).
Readers pull bloom filters and indexes first, then range-read only relevant row groups/columns;
Parquet footer, column index, and offset index are cached
([parquet config](https://grafana.com/docs/tempo/latest/configuration/parquet/)). The design doc
records **trace-level projections precomputed at write time** (root span name/service, trace
duration) and dedicated columns for hot attributes; row groups are the parallel-search sharding unit
(0.18s Parquet vs 21.1s protobuf on the same query)
([Parquet design proposal](https://github.com/grafana/tempo/blob/main/docs/design-proposals/2022-04%20Parquet.md)).
TraceQL search returns **spansets** (matching spans + trace summary), capped, never full traces
([TraceQL](https://grafana.com/docs/tempo/latest/traceql/)).

**Jaeger UI shows both the technique and the failure mode.** Trace fetch is whole-trace by ID
(gRPC streams chunks but the client accumulates everything)
([query.proto](https://github.com/jaegertracing/jaeger-idl/blob/main/proto/api_v2/query.proto)).
The timeline is a custom virtualized list: absolutely-positioned rows inside a container sized by
`Positions.getEstimatedHeight()`, row heights **estimated then corrected by measuring rendered DOM**,
rAF-batched scroll
([ListView source](https://github.com/jaegertracing/jaeger-ui/tree/main/packages/jaeger-ui/src/components/TracePage/TraceTimelineViewer/ListView)).
The minimap draws every span as a rect on a canvas with height `clamp(canvasHeight/itemCount, 2, 6)`px
and alpha 0.8 — beyond ~200 spans rows overlap into a **density map**; O(spans) draws, once
([render-into-canvas.ts](https://github.com/jaegertracing/jaeger-ui/blob/main/packages/jaeger-ui/src/components/TracePage/TracePageHeader/SpanGraph/render-into-canvas.ts)).
But whole-trace fetch caps it: ~1k spans laggy, ~5k failing; the long-open fix proposal is top-N
spans (~200) with expandable sections and tags/logs deferred until expansion
([jaeger#178](https://github.com/jaegertracing/jaeger/issues/178),
[jaeger-ui#645](https://github.com/jaegertracing/jaeger-ui/issues/645)).

**Honeycomb** hard-caps the waterfall at **32,000 spans**: over that, it shows the 32k spans closest
to root (breadth-first), a warning, and **placeholder spans where omitted subtrees would be**,
steering users to aggregate views instead
([docs](https://docs.honeycomb.io/troubleshoot/common-issues/data-in-honeycomb/)).

### LLM-observability tools (LangSmith, Langfuse, Braintrust, W&B Weave)

**Storage converges on columnar + blob offload.** Langfuse v3 moved traces to ClickHouse with
event-sourced ingest (raw events to S3 first, async workers materialize into ClickHouse); v4
collapses to a single immutable observations table with trace attributes denormalized onto every row
and materialized views for dashboards
([v3 blog](https://langfuse.com/blog/2024-12-langfuse-v3-infrastructure-evolution),
[v4 blog](https://langfuse.com/blog/2026-03-10-simplify-langfuse-for-scale)). LangSmith: ClickHouse +
S3 blob offload for large payloads
([self-host scale](https://docs.langchain.com/langsmith/self-host-scale)). Braintrust's Brainstore
runs directly over object storage: WAL files, background compaction into time-ordered **segments
guaranteeing all spans of a trace are colocated**, each segment carrying row store + inverted index +
column store + bloom filters; their traces reach tens of GB
([architecture](https://www.braintrust.dev/blog/brainstore-architecture)). Weave: ClickHouse
AggregatingMergeTree merging call start/end rows, bloom-filter index on `trace_id`
([wandb/weave migrations](https://github.com/wandb/weave)).

**Payloads are split from the skeleton everywhere.** Langfuse extracts media to S3 as references
([multi-modality](https://langfuse.com/docs/observability/features/multi-modality)); Braintrust
attachments upload separately, are unindexed, and lazy-render in the UI
([attachments](https://www.braintrust.dev/docs/guides/attachments)); Langfuse's trace-detail API
fetches observation metadata with `includeIO: false` and lazy-loads input/output per selected
observation (`web/src/server/api/routers/traces.ts`); Braintrust serves trace-by-ID from an ephemeral
structure of **just IDs + timestamps**, fetching payloads on demand
([architecture](https://www.braintrust.dev/blog/brainstore-architecture)).

**Everyone caps the detail view.** LangSmith: 25,000 runs/trace, further runs rejected
([docs](https://docs.langchain.com/langsmith/observability-concepts)). Langfuse: 10,000 observations
shown per trace ("Trace truncated" toast; `MAX_OBSERVATIONS_PER_TRACE` in
`packages/shared/src/server/repositories/events.ts`), ~1MB event size. Weave: rows over 3.5 MiB get
oversized fields replaced with an `<EXCEEDS_LIMITS>` placeholder
([limits](https://docs.wandb.ai/weave/details/limits)). Braintrust: 20MB/span, attachments unbounded.
Langfuse v4 notably **demotes the waterfall**: the primary UI is a flat, filterable observations
table because "the interesting ones are rarely at the top level"
([blog](https://langfuse.com/blog/2026-03-10-simplify-langfuse-for-scale)).

**Write-time precomputation**: Langfuse computes tokens/costs in async ingest workers, denormalizes
context onto every observation, and maintains truncated "display" variants via materialized views;
Weave precomputes stats views at storage time.

---

## The five patterns that transfer to inspect

Inspect's constraints: no query engine at read time (plain HTTP range reads over static hosting/S3),
append-written zip logs, unknown-until-finalize totals during live view. Every system above either
has a server-side engine (Perfetto trace_processor, ClickHouse) or moved the engine's work to
**write-time file layout** (Tempo, Brainstore). Only the second camp transfers directly — and its
patterns are consistent:

### 1. Skeleton/payload separation with lazy hydration

The single most universal pattern. Serve a lightweight skeleton first — event IDs, types, spans,
timings, sizes — and fetch full event bodies / messages / attachments by offset only on demand
(Brainstore's IDs+timestamps structure, Langfuse `includeIO: false`, Braintrust attachments,
jaeger#178's "defer tags/logs until expansion"). For inspect: a per-sample **manifest** zip member
(small, fetched first) describing the event skeleton, with events/messages/attachments in
separately-addressable chunk members range-read on selection. The zip central directory already
plays the role of Parquet's footer — one range read to learn where everything lives.

### 2. Write-time sidecar index over immutable chunks (the Tempo model)

Precompute at finalize (and incrementally at flush) what a server would otherwise compute at query
time: per-chunk extents (event-index range, time range, byte offsets), trace-level rollups (counts,
durations, token totals), and hot-field projections for search. Reads then follow Tempo's shape —
small index first, then targeted range reads of only the relevant chunks — with no server. This is
also what makes "scrollbar with unknown totals" a non-problem for finished logs: the index makes
totals known and cheap.

### 3. Self-delimiting, independently-decodable append chunks

Perfetto's wire format shows how to make appendability a format property: self-delimiting packets,
per-sequence interning dictionaries, and explicit `incremental_state_cleared` reset markers so any
suffix/range is decodable without unbounded prefix state. For inspect's message/attachment pools
(`_condense.py` interning), that means **per-chunk dictionaries or an addressable shared pool** —
never interning state that requires replaying all prior chunks. This also unifies live view: the
live buffer's append-only segment zips and the final format become the same read path.

### 4. Precomputed multi-resolution summaries for outline/minimap

Perfetto's mipmap (one representative slice per pixel-bucket per depth) and Jaeger's alpha-blended
canvas density map both render overviews in O(pixels)/O(n-once), not O(events-per-frame). Without a
query engine, the mipmap levels must be **materialized at write time**: a small appended summary
stream (per-bucket event counts, max-duration spans, error markers, token rates) at 2–3 resolutions,
so the outline/timeline/minimap costs one small range read regardless of sample size. Same story for
search: a precomputed hot-field projection (event type, span, model, error) supports client-side
filtering over the skeleton without fetching bodies.

### 5. Estimate-then-correct virtualization, plus explicit caps with escape hatches

jaeger-ui's ListView proves counts-known/heights-unknown virtualization works fine: estimated row
heights corrected by measurement, converging scrollbar. Inspect's `VirtualList` is already in this
family; the index (pattern 2) supplies exact counts. And every production system ships a cap rather
than pretending full fidelity: Honeycomb's BFS-nearest-root 32k + placeholder subtrees is the most
graceful degradation design (structure preserved, detail elided, "load more" per subtree) — the
right model for old-format huge samples where feature-dropping is the accepted fallback, and for
per-field truncation with a "load full" action (Weave's placeholder, Langfuse's truncated variants).

### Cross-cutting cautions

- **Whole-entity fetch is the failure mode**, not rendering: Jaeger and catapult both virtualized
  rendering yet died on fetch/parse of the full trace. Chunking must be format-level (as #1's
  constraints require) — UI virtualization alone does not solve this.
- **JSON's per-event repetition is the size multiplier** Perfetto/Tempo escaped via interning and
  columnar layout; inspect's message/attachment pools already capture much of this — keep them
  addressable, not inline.
- **Aggregate views beat waterfalls at scale** (Honeycomb's guidance, Langfuse v4's flat filterable
  table): at 337k events, filter/search over the skeleton is the primary navigation, the
  scroll-everything transcript secondary.
