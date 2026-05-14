# Cache Calc

A modern, browser-based **cache, memory, and virtual-memory bits calculator** for computer-architecture students. Originally a Python/Flask app from a college course — rebuilt as a static Cloudflare Worker so it loads instantly and runs entirely in your browser.

**Live demo:** _(deploy to fill in)_

## Features

- **Bidirectional auto-fill.** Type into either side of an equation (e.g. `cache_size` ↔ `num_blocks`, `block_size` ↔ `offset_bits`, `num_sets` ↔ `index_bits`, `address_size` ↔ `addressable_memory`, `pagesize` ↔ `page_offset_bits`) and the other side recomputes. The most-recently-edited field always wins.
- Cache configuration: blocks, sets, index/tag/offset bits, tag storage, valid-bit overhead.
- Memory configuration: physical/virtual address space, page size, virtual/physical pages, page-table size, VPN bits.
- TLB tag and index bits.
- Unit selectors (B / KB / MB / GB) with live unit conversion.
- Light / dark theme.
- Mobile-friendly responsive layout.
- Zero server compute — everything runs client-side.

## How the solver works

Each input field has one of three states: `empty`, `user`, or `auto`. Every keystroke from the user gets a monotonically-increasing recency stamp. A derivation rule may overwrite a field only when at least one of its inputs is *more recent* than the target. The currently-focused field is never touched. This is what makes both sides of every equation freely editable.

## Develop & deploy

```bash
npm install
npm run dev      # local preview at http://localhost:8787
npm run deploy   # publish to Cloudflare
```

You'll need [Wrangler](https://developers.cloudflare.com/workers/wrangler/) installed and a Cloudflare account.

## Project layout

```
cache-calc/
├── public/         # static assets served by the Worker
│   ├── index.html
│   ├── styles.css
│   └── app.js      # solver + UI
├── src/
│   └── worker.js   # tiny Worker that just serves /public
├── wrangler.jsonc
└── package.json
```

## License

MIT — free for student and educational use.
