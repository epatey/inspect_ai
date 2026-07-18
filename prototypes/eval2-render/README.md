# eval2-render — PROTOTYPE, throwaway

Answers wayfinder ticket [epatey/inspect_ai#8](https://github.com/epatey/inspect_ai/issues/8):
can the browser render paginated `.eval2` samples with a windowed transcript?
**Results and design conclusions: [FINDINGS.md](FINDINGS.md).** Not production code —
the validated decisions flow into the design spec, not this tree.

## Run

Needs an extracted `.eval2` sample dir (default root `/private/tmp/newevals`; the
`inspect log convert-eval2` converter lives on the `scale-prototype` branch) plus the
skeleton/stats artifacts this prototype's generator adds:

```
python3 tools/gen_skeleton.py <root>/<log>/new/extracted/samples/<sample_dir>
npm install
LOG_ROOT=<root> npm run dev
```

Samples served under `/data/*`; the picker's paths are hardcoded in `src/App.tsx`.

## Map

- `tools/gen_skeleton.py` — offline `skeleton.json` + `events/stats.json` producer (ratified #5 spec)
- `src/data/` — chunk store, `FilteredCursor` (layer 1), decode walk (layer 2), estimate-then-correct `RowSpace`, skeleton index
- `src/ui/` — virtualized transcript (placeholders, sticky breadcrumb, anchor-lock), skeleton-only outline, HUD (fetch meter, latency knob, type filter)
- `findings/` — screenshots from the reference 337k-event sample
