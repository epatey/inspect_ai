# Zip/compression mechanics for chunked, range-readable logs

Research findings for [epatey/inspect_ai#3](https://github.com/epatey/inspect_ai/issues/3)
(part of #1, blocking #4). Question: what are the mechanical constraints and best
practices for a chunked, range-readable log format inside (or beside) a zip?

All claims cite primary sources (specs, first-party docs, source code). Where a number
is derived arithmetic, the derivation is shown.

## TL;DR / recommended chunk-size envelope

- **Chunk = one independently-compressed zip member of ~1–8 MiB uncompressed**
  (floor ~256 KiB, ceiling ~16 MiB compressed). Do **not** use one member per
  event: 350k members means a ~26–40 MB central directory and ~50 MB of pure
  zip metadata, and per-event range GETs are latency-pathological.
- **Member count ≤ ~10k per archive** keeps the central directory ≤ ~1 MB
  (fetchable in one extra range request after the EOCD tail read).
- Random access *within* a compressed member is not practical (deflate needs an
  external ~32 KiB/point index; zstd seekable format is `contrib/`-status with no
  browser implementation) — so **the chunk boundary must be the member boundary**,
  BGZF-style.
- Cloud reads: request cost is negligible at any sane chunk size; per-request
  first-byte latency (~100–200 ms) is the real cost. 8–16 MB is AWS's throughput
  sweet spot; 256 KiB–1 MiB is a better interactive-viewer floor. One presigned
  URL (max 7 days) serves all chunks (Range is unsigned by default); pin `ETag`
  with `If-Match`; CORS must allow `Range` and expose `ETag`/`Content-Range`.
- Browser: multi-GB IndexedDB is within quota on Chrome/Safari (60% of disk;
  Firefox caps best-effort at 10 GiB/site-group). 350k parsed JS objects are cheap
  (~20–60 MB) but their *strings* are not (~0.5–1 GB at 1.5 KB/event) against a
  V8 heap capped at 4 GB — keep chunks as raw `ArrayBuffer`s + a typed-array
  offset index, and lazy-parse only the visible window.

---

## 1. ZIP64 limits and 100k+ member practicality

Source: [PKWARE APPNOTE.TXT](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT).

- Classic zip: **65,535 members max** (§4.4.22, 2-byte field), **4 GiB** per-member
  sizes and central-directory offset (§4.4.8–9, §4.4.24, 4-byte fields).
- ZIP64 kicks in per-field when a value overflows (field set to 0xFFFF/0xFFFFFFFF
  sentinel, §4.4.1.4). Limits become 2^64−1 entries and 2^64−1-byte sizes/offsets
  (§4.3.14).
- **Any archive with >65,535 members requires a ZIP64 EOCD record** regardless of
  byte size. All mainstream writers emit it automatically (Python `allowZip64=True`
  default; Go; zip CLI), and our `AsyncZipReader` already parses ZIP64 EOCD/locator
  (`src/inspect_ai/_util/async_zip.py`, `_find_central_directory`).

So 100k+ members is *legal* and works everywhere. The problem is cost, not legality
(next section).

## 2. Central-directory size and parse cost at high member counts

Record sizes (APPNOTE §4.3.7, §4.3.12, §4.3.16): local file header = 30 bytes +
filename; central-directory record = 46 bytes + filename (+ extras); EOCD = 22 bytes.

Central-directory size at 46 + filename_len per entry (no extras):

| Members | 30-char names | 35-char names | 40-char names |
|---|---|---|---|
| 100,000 | 7.6 MB | 8.1 MB | 8.6 MB |
| 350,000 | 26.6 MB | 28.4 MB | 30.1 MB |

ZIP64 extended-info extras (+~12 B/entry in >4 GiB archives) and timestamp/UID extras
(+~20 B/entry from some writers) push a realistic 350k-member CD to **~26–40 MB that
must be fetched and parsed before the first member can be located**.

Parse cost is O(n) with no lazy option in most readers:

- CPython `zipfile` reads the whole CD into memory and builds a `ZipInfo` per entry
  ([source](https://raw.githubusercontent.com/python/cpython/main/Lib/zipfile/__init__.py),
  `_RealGetContents`); EOCD located by backward scan of up to 65,557 tail bytes
  (`_EndRecData`).
- Go `archive/zip` does the same loop
  ([reader.go](https://raw.githubusercontent.com/golang/go/master/src/archive/zip/reader.go)).
- [yauzl](https://github.com/thejoshwolfe/yauzl) offers `lazyEntries: true` precisely
  because eager entry materialization is the memory cost at high counts.
- Benchmarks: [fasterzip](https://github.com/TkTech/fasterzip) measured **~3.4 s for
  CPython `zipfile` to open a 100,000-member archive** (vs ~1.2 s in C) — per-entry
  Python-object cost dominates. See also
  [cpython #126565](https://github.com/python/cpython/issues/126565),
  [zip.js #387](https://github.com/gildas-lormeau/zip.js/discussions/387).

Remote CD reads via range requests are a standard pattern (our `AsyncZipReader`;
[zip.js `HttpRangeReader`](https://gildas-lormeau.github.io/zip.js/api/classes/HttpRangeReader.html)):
one suffix range for the EOCD tail (≤65,557 bytes worst case; ours requests exactly
`_MAX_ZIP_COMMENT_SIZE + _MIN_EOCD_SIZE`), one for the CD span, then one per member.
At 350k members that CD span is the ~28 MB above — **CD size is the dominant
first-byte cost for remote open**, which is the core argument for bounding member count.

Per-member structural overhead: ~76 fixed bytes + filename twice ≈ **146 B/member**
at 35-char names (+16 for data-descriptor variants) → ~51 MB at 350k members, ~73%
overhead on a 200-byte member. Independent per-member compression also forfeits
cross-record redundancy (each member restarts its LZ/entropy context —
APPNOTE §4.3.8, [RFC 1951](https://www.rfc-editor.org/rfc/rfc1951.txt)).

## 3. Random access within a compressed member

- **Deflate: no.** Back-references reach 32 KiB into prior *output* (RFC 1951 §2,
  §3.2.5) and blocks are neither byte-aligned nor self-delimiting (§3.2.3), so
  decoding from an arbitrary offset requires a bit-precise entry point plus the
  preceding 32 KiB window — recoverable only from an external index. zlib's
  [zran.c](https://github.com/madler/zlib/blob/master/examples/zran.c) builds one at
  **~32 KiB per access point** (default span 1 MiB).
- **Zstd seekable format: yes in principle, immature in practice.** Independent
  frames + a seek-table skippable frame at EOF (8 or 12 B/frame + 9-byte footer;
  max 1 GiB/frame)
  ([spec](https://github.com/facebook/zstd/blob/dev/contrib/seekable_format/zstd_seekable_compression_format.md)).
  But it lives in `contrib/` at spec v0.1.0 (2017), ships only as C, and **no browser
  implementation exists** — browsers have no native zstd API (only HTTP
  `Content-Encoding`); wasm decoders (e.g.
  [zstd-wasm](https://github.com/bokuweb/zstd-wasm), `fzstd`) don't implement the
  seekable layer. The
  [README](https://github.com/facebook/zstd/blob/dev/contrib/seekable_format/README.md)
  warns frames <1 KB have "a large negative impact on compression ratio".
- **The robust pattern is independent compression per chunk** — exactly what zstd
  seekable does internally, and what BGZF (the SAM/BAM block-gzip format,
  [SAMv1 spec §4.1](https://samtools.github.io/hts-specs/SAMv1.pdf)) has proven at
  scale: concatenated ≤64 KiB gzip members (valid per
  [RFC 1952 §2.2](https://www.rfc-editor.org/rfc/rfc1952.txt)) addressed by 64-bit
  virtual offsets `coffset<<16 | uoffset`. In a zip, the member boundary *is* the
  chunk boundary and the central directory *is* the offset index — no side file
  needed. Ratio loss from independent blocks is modest once blocks exceed the
  compressor window (≥64 KiB fine for deflate; zstd wants ≥~100 KiB, penalty
  negligible by ~1 MiB); no primary source publishes exact %-loss tables.

Viewer constraint already encoded in our writer: the pure-JS `fzstd` decoder
overflows on compressed frames ≥256 MiB, so `src/inspect_ai/_util/zipfile.py` caps
zstd frames at 200 MiB of *input* (`_MAX_INPUT_PER_FRAME`). Any chunk in the
recommended envelope is 1–2 orders of magnitude below this.

## 4. Append-only zip write semantics (current `ZipLogFile`)

Cross-checked against `src/inspect_ai/log/_recorders/eval.py`:

- The zip is built in a **local `tempfile.TemporaryFile()`** opened as
  `ZipFile(mode="a")` with zstd compression (`ZIP_ZSTANDARD`, level 3 —
  `src/inspect_ai/_util/zipfile.py`). Today's layout is already one-member-per-sample
  (`samples/{id}_epoch_{epoch}.json`) plus journalled summary members
  (`_journal/summaries/N.json`), `header.json`, `reductions.json`.
- Member data is genuinely append-only: `writestr` appends at the current end;
  Python's append mode positions the write pointer at `start_dir` (start of the old
  central directory), so **each flush overwrites the previous CD with new members and
  writes a fresh CD at close**. Member bytes are never rewritten; only the CD is.
- `flush()` closes the ZipFile (materializing the CD), then copies the **entire**
  temp file to the destination — atomic local write, or full-object streaming upload
  for remote. S3/GCS objects are immutable, so **remote "append" is always a
  whole-object re-upload**; there is no ranged append. Growth in flush cost is
  O(total log size), not O(delta).
- Header edits: local = in-place CD surgery (drop `header.json` from the CD, append a
  new member + CD; old header bytes leak as dead space — documented tradeoff in
  `_replace_eval_header_in_place`); remote = full download → rewrite (decompress +
  recompress every member) → upload, with S3 `If-Match` conditional-write protection
  (`_write_s3_conditional`, ETag preflight).
- Read path (`AsyncZipReader`): suffix range request for EOCD (+ ZIP64), CD fetch,
  then one range request per member with streaming decompress; captures the CD-read
  ETag for consistency checks. Default streaming chunk 1 MiB.

Implication for chunking: a chunked format is *compatible* with the existing
append-mode writer — chunks are just members, and appending a chunk + rewriting the
CD is exactly what the writer already does per flush. What chunking fixes is the
reader side (bounded CD, bounded per-request over-read); it does not by itself fix
the O(total-size) remote re-upload per flush.

## 5. HTTP range requests over S3/GCS

- **Single range per GET** on both stores — S3
  ([GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html):
  "Amazon S3 doesn't support retrieving multiple ranges of data per GET request")
  and GCS
  ([XML API](https://cloud.google.com/storage/docs/xml-api/get-object-download)).
  Multi-chunk read = one request per chunk.
- **AWS-recommended range size: 8–16 MB**, aligned to multipart part boundaries when
  possible ([S3 performance whitepaper](https://docs.aws.amazon.com/whitepapers/latest/s3-optimizing-performance-best-practices/use-byte-range-fetches.html));
  concurrent ranged GETs over separate connections are the documented throughput
  pattern.
- **Pricing** is identical and negligible: $0.0004 per 1,000 GETs (S3 Standard
  us-east-1; GCS Class B standard single-region). 350,000 GETs = $0.14; 1,000 = $0.0004.
- **Rate limits:** S3 ≥5,500 GET/s per prefix
  ([performance docs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html));
  GCS ~5,000 object reads/s initial per bucket, ramp no faster than 2× per 20 min
  ([request-rate guidelines](https://cloud.google.com/storage/docs/request-rate)).
- **First-byte latency:** S3 documents ~100–200 ms TTFB (tens of ms median for
  <512 KB requests). This, not price, is the cost of small chunks.
- **Presigned/signed URLs:** max expiration **7 days** on both (SigV4
  [query-string auth](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html);
  GCS V4 [signed URLs](https://cloud.google.com/storage/docs/access-control/signed-urls));
  shorter when minted from temporary credentials. `Range` is **not signed by
  default** (only `host` is), so one URL serves arbitrarily many differently-ranged
  GETs on both stores.
- **CORS for browser readers:** allow `Range` in allowed headers; expose `ETag` and
  `Content-Range` (not CORS-safelisted) —
  [S3 CORS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html),
  [GCS CORS](https://cloud.google.com/storage/docs/cross-origin).
- **Mutation guard:** capture `ETag` on the CD read, send `If-Match` on every
  subsequent ranged GET; 412 = log rewritten mid-read
  ([GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)).
  `AsyncZipReader.etag` already captures this.

Tradeoff for reading 100 MB of a 2 GB log ($0.0004/1k GETs; ~150 ms TTFB each):

| Chunk size | Requests | Request cost | TTFB overhead (serial) | TTFB (32-way parallel) |
|---|---|---|---|---|
| 64 KB | 1,600 | $0.00064 | ~4 min | ~7.5 s |
| 256 KB | 400 | $0.00016 | ~60 s | ~1.9 s |
| 1 MB | 100 | $0.00004 | ~15 s | ~0.5 s |
| 8 MB | 13 | $0.0000052 | ~2 s | ~0.2 s |
| 16 MB | 7 | $0.0000028 | ~1 s | ~0.15 s |

## 6. Browser-side limits

Quota (per origin):

| Browser | Best-effort | Notes |
|---|---|---|
| Chrome/Edge | up to 60% of disk | eviction begins ~80% disk browser-wide ([web.dev](https://web.dev/articles/storage-for-the-web)) |
| Firefox | min(10% of disk, **10 GiB per eTLD+1 group**) | `persist()` (permission prompt) unlocks 50% of disk ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)) |
| Safari 17+ | up to 60% of disk | plus 7-day inactivity eviction for non-installed sites ([WebKit blog](https://webkit.org/blog/14403/updates-to-storage-policy/)) |

Multi-GB IndexedDB is within quota on Chrome/Safari for any normal disk; **Firefox's
10 GiB group cap is the binding constraint** without `persist()`. Handle
`QuotaExceededError`; use `navigator.storage.estimate()`.

IndexedDB performance: every `put` structured-clones on the main thread
([web.dev best practices](https://web.dev/articles/indexeddb-best-practices));
transaction overhead dominates per-record cost (~1k docs ≈ 80 ms in one transaction
vs ~2 s as separate transactions; [rxdb.info benchmark](https://rxdb.info/slow-indexeddb.html),
secondary source). Pattern: batch records per transaction; store chunks as
`ArrayBuffer`/`Blob`, not deep object trees.

Memory of ~350k events in V8 (pointer compression, 4-byte tagged fields —
[v8.dev](https://v8.dev/blog/pointer-compression)):

- **Object structure is cheap:** 350k × (12 B header + 10×4 B slots) ≈ **18 MB**
  (+~40 MB worst case for boxed doubles); a 350k-element array backing store ≈ 1.4 MB
  ([slack tracking](https://v8.dev/blog/slack-tracking),
  [fast properties](https://v8.dev/blog/fast-properties)).
- **Strings dominate:** 350k × 1.5 KB avg ≈ **~525 MB Latin-1 / ~1.05 GB two-byte** —
  13–50% of the V8 heap, which pointer compression caps at **4 GB per renderer**
  ([v8.dev](https://v8.dev/blog/pointer-compression)).
- `ArrayBuffer` backing stores cost exactly byteLength and live **outside** the 4 GB
  cage. Lazy-parse pattern: raw chunk bytes + typed-array offset index
  (350k × 4–8 B = 1.4–2.8 MB), decode only the visible window. This is the only
  pattern that keeps a multi-GB log viewable.

## 7. Recommended chunk-size envelope (synthesis)

**Envelope: 1–8 MiB uncompressed per chunk; hard floor ~256 KiB, hard ceiling
~16 MiB compressed. Bound member count to ≤ ~10k per archive.**

Rationale per bound:

- **≥ ~256 KiB:** amortizes the ~100–200 ms cloud TTFB (a 256 KiB–1 MiB chunk is
  latency-bound, not cost-bound, and parallelizes); far above the deflate 32 KiB
  window and zstd's <1 KB ratio-loss warning, so independent-compression penalty is
  negligible; keeps per-chunk zip metadata (~146 B) at noise level.
- **≤ ~16 MiB:** top of the AWS-recommended range band; bounds browser memory and
  decode latency per fetch (interactive seeks over-read at most one chunk); bounds
  IndexedDB structured-clone/write units; 12× under the fzstd 200 MiB frame cap.
- **≤ ~10k members:** CD stays ≤ ~1.5 MB → remote open = 2 range requests (EOCD tail
  + CD) with sub-second parse everywhere, vs ~28 MB / multi-second at 350k members.
  A 2 GB log at 1–8 MiB chunks is 256–2,000 members — comfortably inside.
- Within a chunk, records are addressed by (member, uncompressed offset) — the BGZF
  virtual-offset idea — carried in a small index member (or the existing journal
  summaries), since in-member seeking is off the table (§3).

Anti-patterns ruled out by the numbers: one member per event (§2 metadata/CD blowup,
§5 request-count latency); one giant compressed member (no random access without a
zstd-seekable-style layer that browsers can't read, §3); parsing all events to JS
objects up front (§6 string heap vs 4 GB cap).
