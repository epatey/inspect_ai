# Findings: rendering `.eval2` in a windowed transcript

Prototype for wayfinder ticket [#8](https://github.com/epatey/inspect_ai/issues/8) — prove the browser client can consume paginated `.eval2` files. Built against real converted logs, primarily the reference monster (`mirror-code/ngnk_python`: **337,351 events / 129,676 messages / 85,062 attachments**, 963MB extracted, the 10B-token sample).

**Verdict: proven.** Open-at-end of the 337k-event sample cost **9 requests / ~3 event chunks**; a session of open-at-end + two deep jumps + a fling-scroll + collapse/expand + type filtering touched **17 of 338 event chunks**. The outline renders from the skeleton with **zero event reads**. Collapsing the 337k-event agent span is **free** (no fetches; row space drops 142,908 → 20 rows).

## What was built

Standalone Vite app (`prototypes/eval2-render/`), throwaway. `@tanstack/react-virtual` (the same core production's `VirtualList` wraps) over the chunked format:

- `tools/gen_skeleton.py` — offline producer of `skeleton.json` + `events/stats.json` per the **ratified #5 spec** (the converter predates that decision). On the monster: 60,900 raw spans → **673 structural** after leaf-tool exclusion (98.9% excluded — the tool-span trap, quantified); skeleton **297KB** (< the doc's 1MB bound); stats 90KB.
- Data layer: shell `sequences` → chunk starts (no directory needed); per-sequence chunk cache; `FilteredCursor` (layer 1, stats pushdown); decode walk (layer 2, skeleton seeks + run coalescing); estimate-then-correct row space.
- UI: virtualized transcript with placeholder rows, sticky span breadcrumb from `spanStackAt` (span_begin events never fetched for it), skeleton-only outline (span rows + `gap_models` turn rows + notables), lazy model-input hydration, per-type filter, latency knob (0–1s), fetch HUD.

Extracted-dir GETs stand in for zip-member range reads (mechanics settled by research ticket #3); chunk starts from `sequences` stand in for the central directory. Screenshots in `findings/`.

## View-row pagination draft: RATIFIED, with amendments

The two-layer decode works as drafted. The I/O invariant **reads ∝ rows emitted** held throughout — density absorbed by the cursor, collapsed spans one row + one seek, filter-empty spans free via `hasVisibleContents` from skeleton counters.

Amendments and refinements (feed **#9**):

1. **Row accounting per event-chunk, not a global segment tree.** The draft leaves the "global view-row index space" abstract. The workable landing: each event chunk carries an estimated surviving-row count (from its stats, minus collapse-elision overlap, runs guessed at avg length); decoding a chunk's window corrects it to exact. Corrections are bounded and local; prefix sums over ≤~10k chunks are trivial. This also makes **the chunk the decode unit**, aligned with the fetch unit.
2. **Upward pagination simplifies away.** With chunk-granular decode, the draft's "reversed cursor" is unnecessary: scrolling up materializes the chunk above via the same forward walk. The only cross-boundary concern is a run straddling chunks, handled by the head-run-continuation rule: if the previous chunk's stats `last` (type+span_id) matches this chunk's `first` for a run type, the head run is consumed rowless (it belongs to the chunk where the run starts). The #5 amendment putting first/last type+span_id in the stats sidecar is **exactly sufficient** — O(1) edge resolution, confirmed.
3. **Estimate-then-correct needs an ordinal anchor.** TanStack absorbs measured-height corrections, but row-count corrections above the viewport shift content. Fix that worked: track the topmost visible ordinal; on correction, re-scroll to `rowIndexForOrdinal(anchor)`. Ordinals (not row indexes) are the stable coordinate system — same conclusion as #5's scroll-sync contract. With it, corrections during normal scrolling were not perceptible; jumps into cold regions settle in one correction.
4. **Run coalescing from stats works but was rarely exercised at chunk scale** in these logs (sandbox runs of 1–40 events, chunk = 1000). The uniform-chunk fast path (swallow a chunk from stats unread) is implemented and correct but needs a pathological log (e.g. 100k-event sandbox run) to prove its value. Low risk: it degrades to reading edge chunks.
5. **Retry grouping not implemented** (window-local with margin per the audit); nothing observed contradicts that plan.

## Confounder 1 (last-page open): RATIFIED as drafted

Open lands at the transcript end after shell+skeleton+stats (3 requests) + ~3 event chunks. The final model event's **1,326-message input** renders its frame (count + ranges) from `input_refs` with zero message reads; expanding hydrated the visible tail for **1 message chunk + 1 attachment chunk**, displaying "… 1,314 earlier messages not fetched …". Range-encoded refs stayed tiny in row snippets (`[[0,2],[128352,129676]]`).

## What the UI actually needed from the data layer (the #9 contract)

The complete surface the transcript+outline consumed:

- `shell.sequences` — chunk boundaries per sequence (the only "directory"); `message_refs`.
- `skeleton.json` — span table (`spanStackAt`, `byBeginOrdinal`, extents, `events`/`models`/`gap_models`/`children` counters), notables.
- `events/stats.json` — per-chunk sparse type counts + first/last type+span_id.
- `getRange(sequence, [lo, hi))` — chunk-cached random access, all four sequences.
- `readEvents(from, {types, max})` / FilteredCursor — the one nontrivial primitive.

No server, no other index. Everything else was viewer policy.

## New facts surfaced (for #9 and the spec)

1. **`attachment://` refs surface in row snippets.** Tool-call args (`bash({"cmd":"attachment://55150"})`), model completions, and message previews render raw refs. One-line rows want a **synchronous** snippet; hydrating attachments per visible row is an extra fetch layer the draft doesn't discuss. Options for #9: eager smalls (write-time inline threshold tuned for snippet-sized strings), a snippet field in the event body (persisted transformed output — against principle), or async snippet hydration with shimmer (what the prototype does for messages; tolerable but visible). Interacts with the parked events+attachments comingling lever (−24.4%): comingled chunks would make most snippet attachments arrive with their event chunk.
2. **Sticky breadcrumb wants nothing new** — `spanStackAt` over extents answered it always, including with the span_begin unfetched. The "sticky span headers when the span-begin isn't loaded" worry dissolves: headers come from the skeleton, not from rendered rows.
3. **Escape-hatch tool spans behave well**: 664 monster tool spans (≥1k events) survived exclusion, giving fetch elision + outline rows inside the agent loop; leaf exclusion still removed 98.9%. The ~1-chunk hatch (#5 amendment 1) looks right in practice.
4. **Dedup by URL belongs in the fetch layer** (React StrictMode double-mount exposed it; production's remote file layer already caches).
5. **Untested here**: interleaved/parallel spans (absent from these logs — extent-overlap tolerance unexercised); legacy step-only logs; the monolith small-sample path (#17); zstd-in-zip reads (settled by #3 but not re-proven end-to-end).

## Scroll velocity vs fetch latency

At 300ms artificial latency, a fling through ~3k cold ordinals showed shimmer placeholders in flight and settled ~1 RTT after stopping; a visible window spans ≤2 event chunks, so steady scrolling stays 1–2 requests deep. At 0ms (localhost) placeholders are barely visible. Feels fine; the real S3 test needs the zip path.

## Run it

```
cd prototypes/eval2-render
python3 tools/gen_skeleton.py /private/tmp/newevals/<log>/new/extracted/samples/<sample>   # once per sample
npm install && npm run dev    # vite dev server; LOG_ROOT env to point at a different log root
```
