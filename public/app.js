// Cache Calc — client-side bidirectional solver.
// Every input field carries one of three states: 'empty', 'user', 'auto'.
// Each user edit gets a monotonically-increasing recency stamp. A derivation
// rule can only overwrite a target field if at least one of its inputs has a
// higher recency than the target — i.e. "the value you most recently typed
// always wins". This is what makes both sides of an equation editable.

(() => {
  // ─────────────────────────────── constants ───────────────────────────────
  const UNITS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };

  // DOM-input field metadata. `kind: 'size'` means the input is paired with a
  // unit selector and stored internally in bytes. `kind: 'int'` is a plain
  // integer (bits / counts). All values are stored in canonical units in
  // `vals` regardless of the unit the user selects.
  const FIELDS = {
    cache_size:           { kind: 'size', unitId: 'cache_unit' },
    block_size:           { kind: 'int' },
    num_blocks:           { kind: 'int' },
    associativity:        { kind: 'int' },
    num_sets:             { kind: 'int' },
    index_bits:           { kind: 'int' },
    tag_bits:             { kind: 'int' },
    offset_bits:          { kind: 'int' },
    address_size:         { kind: 'int' },
    addressable_memory:   { kind: 'size', unitId: 'addr_mem_unit' },
    virtual_address_size: { kind: 'int' },
    virtual_memory:       { kind: 'size', unitId: 'virt_mem_unit' },
    pagesize:             { kind: 'size', unitId: 'page_unit' },
    tlb_rows:             { kind: 'int' },
    protection_bits:      { kind: 'int' },
  };

  // ─────────────────────────────── state ───────────────────────────────────
  const state = {};      // id -> 'empty' | 'user' | 'auto'
  const editedAt = {};   // id -> recency counter
  let recencyCounter = 0;
  let activeId = null;   // id currently focused (never overwritten by solver)

  for (const id of Object.keys(FIELDS)) {
    state[id] = 'empty';
    editedAt[id] = 0;
  }

  // ─────────────────────────────── helpers ─────────────────────────────────
  const isPow2 = (x) => Number.isFinite(x) && x > 0 && (x & (x - 1)) === 0;
  const ilog2 = (x) => {
    if (!Number.isFinite(x) || x <= 0) return null;
    const l = Math.log2(x);
    const r = Math.round(l);
    return Math.abs(l - r) < 1e-9 ? r : l; // exact for powers of 2
  };

  const $ = (id) => document.getElementById(id);

  function readField(id) {
    const f = FIELDS[id];
    const el = $(id);
    const raw = el.value.trim();
    if (raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    if (f.kind === 'size') {
      const unit = $(f.unitId).value;
      return n * UNITS[unit];
    }
    return n;
  }

  function writeField(id, canonical) {
    if (id === activeId) return false; // never overwrite focused input
    const f = FIELDS[id];
    const el = $(id);
    let display;
    if (canonical === null || canonical === undefined || !Number.isFinite(canonical)) {
      display = '';
    } else if (f.kind === 'size') {
      const unit = $(f.unitId).value;
      const v = canonical / UNITS[unit];
      display = formatNum(v);
    } else {
      display = formatNum(canonical);
    }
    if (el.value === display) return false;
    el.value = display;
    state[id] = display === '' ? 'empty' : 'auto';
    el.classList.toggle('auto-filled', state[id] === 'auto');
    return true;
  }

  function formatNum(n) {
    if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return Number(n.toFixed(6)).toString();
  }

  function readAll() {
    const v = {};
    for (const id of Object.keys(FIELDS)) v[id] = readField(id);
    return v;
  }

  // ─────────────────────────────── rules ───────────────────────────────────
  // Each rule: { target, inputs[], compute(v) -> number|null }.
  // Both directions of every relation are listed so any side can drive.
  const RULES = [
    // block_size ↔ offset_bits
    { target: 'block_size', inputs: ['offset_bits'],
      compute: (v) => v.offset_bits != null ? 2 ** v.offset_bits : null },
    { target: 'offset_bits', inputs: ['block_size'],
      compute: (v) => isPow2(v.block_size) ? ilog2(v.block_size) : null },

    // num_sets ↔ index_bits
    { target: 'num_sets', inputs: ['index_bits'],
      compute: (v) => v.index_bits != null ? 2 ** v.index_bits : null },
    { target: 'index_bits', inputs: ['num_sets'],
      compute: (v) => isPow2(v.num_sets) ? ilog2(v.num_sets) : null },

    // cache_size = num_blocks × block_size  (three-way)
    { target: 'num_blocks', inputs: ['cache_size', 'block_size'],
      compute: (v) => v.cache_size != null && v.block_size > 0 ? v.cache_size / v.block_size : null },
    { target: 'cache_size', inputs: ['num_blocks', 'block_size'],
      compute: (v) => v.num_blocks != null && v.block_size != null ? v.num_blocks * v.block_size : null },
    { target: 'block_size', inputs: ['cache_size', 'num_blocks'],
      compute: (v) => v.cache_size != null && v.num_blocks > 0 ? v.cache_size / v.num_blocks : null },

    // num_blocks = num_sets × associativity  (three-way)
    { target: 'num_blocks', inputs: ['num_sets', 'associativity'],
      compute: (v) => v.num_sets != null && v.associativity != null ? v.num_sets * v.associativity : null },
    { target: 'num_sets', inputs: ['num_blocks', 'associativity'],
      compute: (v) => v.num_blocks != null && v.associativity > 0 ? v.num_blocks / v.associativity : null },
    { target: 'associativity', inputs: ['num_blocks', 'num_sets'],
      compute: (v) => v.num_blocks != null && v.num_sets > 0 ? v.num_blocks / v.num_sets : null },

    // address_size = tag_bits + index_bits + offset_bits  (four-way)
    { target: 'tag_bits', inputs: ['address_size', 'index_bits', 'offset_bits'],
      compute: (v) => v.address_size != null && v.index_bits != null && v.offset_bits != null
        ? v.address_size - v.index_bits - v.offset_bits : null },
    { target: 'address_size', inputs: ['tag_bits', 'index_bits', 'offset_bits'],
      compute: (v) => v.tag_bits != null && v.index_bits != null && v.offset_bits != null
        ? v.tag_bits + v.index_bits + v.offset_bits : null },
    { target: 'index_bits', inputs: ['address_size', 'tag_bits', 'offset_bits'],
      compute: (v) => v.address_size != null && v.tag_bits != null && v.offset_bits != null
        ? v.address_size - v.tag_bits - v.offset_bits : null },
    { target: 'offset_bits', inputs: ['address_size', 'tag_bits', 'index_bits'],
      compute: (v) => v.address_size != null && v.tag_bits != null && v.index_bits != null
        ? v.address_size - v.tag_bits - v.index_bits : null },

    // address_size ↔ addressable_memory
    { target: 'addressable_memory', inputs: ['address_size'],
      compute: (v) => v.address_size != null ? 2 ** v.address_size : null },
    { target: 'address_size', inputs: ['addressable_memory'],
      compute: (v) => isPow2(v.addressable_memory) ? ilog2(v.addressable_memory) : null },

    // virtual_address_size ↔ virtual_memory
    { target: 'virtual_memory', inputs: ['virtual_address_size'],
      compute: (v) => v.virtual_address_size != null ? 2 ** v.virtual_address_size : null },
    { target: 'virtual_address_size', inputs: ['virtual_memory'],
      compute: (v) => isPow2(v.virtual_memory) ? ilog2(v.virtual_memory) : null },
  ];

  // ─────────────────────────────── solver ──────────────────────────────────
  function solve() {
    const v = readAll();
    // Provenance = max recency of inputs that produced a value.
    const recency = {};
    for (const id of Object.keys(FIELDS)) {
      recency[id] = state[id] === 'user' ? editedAt[id] : -1;
    }

    let changed = true;
    let iter = 0;
    while (changed && iter < 30) {
      changed = false;
      iter++;
      for (const rule of RULES) {
        // every input must have a value
        if (!rule.inputs.every((i) => v[i] != null)) continue;
        const result = rule.compute(v);
        if (result == null || !Number.isFinite(result) || result < 0) continue;

        const inputRecency = Math.max(...rule.inputs.map((i) => recency[i]));
        const targetRecency = recency[rule.target];
        const cur = v[rule.target];

        if (cur == null) {
          v[rule.target] = result;
          recency[rule.target] = Math.max(inputRecency, 0);
          changed = true;
        } else if (Math.abs(cur - result) > 1e-9) {
          // Only overwrite if target is older than at least one input.
          // Active field is never overwritten.
          if (rule.target !== activeId && targetRecency < inputRecency) {
            v[rule.target] = result;
            recency[rule.target] = inputRecency;
            changed = true;
          }
        }
      }
    }

    return v;
  }

  // ─────────────────────────── derived display ─────────────────────────────
  // Compute output-only values (not editable) from the solved canonical state.
  function deriveExtras(v) {
    const e = {};
    e.num_tags = v.num_blocks;
    e.tag_space_bytes = (v.num_tags != null && v.tag_bits != null)
      ? (v.num_tags * v.tag_bits) / 8 : null;
    if (e.tag_space_bytes == null && v.num_blocks != null && v.tag_bits != null) {
      e.tag_space_bytes = (v.num_blocks * v.tag_bits) / 8;
    }
    e.valid_bits_bytes = v.num_blocks != null ? v.num_blocks / 8 : null;
    e.total_overhead_bytes = (e.tag_space_bytes != null && e.valid_bits_bytes != null)
      ? e.tag_space_bytes + e.valid_bits_bytes : null;

    e.page_offset_bits = isPow2(v.pagesize) ? ilog2(v.pagesize) : null;

    e.virtual_pages = (v.virtual_address_size != null && e.page_offset_bits != null)
      ? 2 ** (v.virtual_address_size - e.page_offset_bits) : null;

    e.physical_pages = (v.addressable_memory != null && v.pagesize > 0)
      ? v.addressable_memory / v.pagesize : null;

    e.phys_page_bits = (v.address_size != null && e.page_offset_bits != null)
      ? v.address_size - e.page_offset_bits
      : (e.physical_pages != null && isPow2(e.physical_pages) ? ilog2(e.physical_pages) : null);

    e.vpn_bits = (v.virtual_address_size != null && e.page_offset_bits != null)
      ? v.virtual_address_size - e.page_offset_bits : null;

    e.page_table_bits = (e.virtual_pages != null && e.phys_page_bits != null && v.protection_bits != null)
      ? e.virtual_pages * (e.phys_page_bits + v.protection_bits) : null;
    e.page_table_bytes = e.page_table_bits != null ? e.page_table_bits / 8 : null;

    e.tlb_index = isPow2(v.tlb_rows) ? ilog2(v.tlb_rows) : null;
    e.tlb_tag = (e.vpn_bits != null && e.tlb_index != null)
      ? e.vpn_bits - e.tlb_index : null;

    return e;
  }

  // ───────────────────────────── rendering ─────────────────────────────────
  function fmtBytes(n) {
    if (n == null || !Number.isFinite(n)) return null;
    if (n === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let i = 0;
    let val = n;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    const s = val < 10 ? val.toFixed(2) : val < 100 ? val.toFixed(1) : Math.round(val).toString();
    return `${parseFloat(s)} ${units[i]}`;
  }
  function fmtInt(n) {
    if (n == null || !Number.isFinite(n)) return null;
    if (Math.abs(n - Math.round(n)) < 1e-9) return Math.round(n).toLocaleString();
    return Number(n.toFixed(4)).toString();
  }

  function renderResults(v, e) {
    const cacheRows = [
      ['Cache Size',           fmtBytes(v.cache_size)],
      ['Block Size',           fmtBytes(v.block_size)],
      ['Associativity',        fmtInt(v.associativity)],
      ['Number of Sets',       fmtInt(v.num_sets)],
      ['Number of Blocks',     fmtInt(v.num_blocks)],
      ['Index Bits',           fmtInt(v.index_bits)],
      ['Offset Bits',          fmtInt(v.offset_bits)],
      ['Tag Bits',             fmtInt(v.tag_bits)],
      ['Number of Tags',       fmtInt(e.num_tags)],
      ['Tag Storage',          fmtBytes(e.tag_space_bytes)],
      ['Valid-Bit Storage',    fmtBytes(e.valid_bits_bytes)],
      ['Total Overhead',       fmtBytes(e.total_overhead_bytes)],
    ];
    const memRows = [
      ['Physical Address Space',  v.address_size != null ? `${fmtInt(v.address_size)} bits` : null],
      ['Physical Memory',         fmtBytes(v.addressable_memory)],
      ['Virtual Address Space',   v.virtual_address_size != null ? `${fmtInt(v.virtual_address_size)} bits` : null],
      ['Virtual Memory',          fmtBytes(v.virtual_memory)],
      ['Page Size',               fmtBytes(v.pagesize)],
      ['Page Offset Bits',        fmtInt(e.page_offset_bits)],
      ['Virtual Pages',           fmtInt(e.virtual_pages)],
      ['Physical Pages',          fmtInt(e.physical_pages)],
      ['Physical Page Bits',      fmtInt(e.phys_page_bits)],
      ['Virtual Page # bits',     fmtInt(e.vpn_bits)],
      ['Page Table Size',         fmtBytes(e.page_table_bytes)],
      ['TLB Index Bits',          fmtInt(e.tlb_index)],
      ['TLB Tag Bits',            fmtInt(e.tlb_tag)],
    ];
    paint('cacheResults', cacheRows);
    paint('memResults', memRows);
  }

  function paint(dlId, rows) {
    const dl = $(dlId);
    const prev = dl._prev || {};
    const next = {};
    const html = [];
    for (const [label, value] of rows) {
      const v = value == null ? '—' : value;
      next[label] = v;
      const fresh = prev[label] !== undefined && prev[label] !== v ? ' fresh' : '';
      const emptyCls = value == null ? ' empty' : '';
      html.push(`<dt>${label}</dt><dd class="${emptyCls.trim()}${fresh}">${v}</dd>`);
    }
    dl.innerHTML = html.join('');
    dl._prev = next;
  }

  // ───────────────────────────── recompute ─────────────────────────────────
  let pending = false;
  function recompute() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const v = solve();
      // Write derived values back into form inputs.
      for (const id of Object.keys(FIELDS)) {
        if (id === activeId) continue;
        if (state[id] === 'user') continue; // don't touch user-typed values
        writeField(id, v[id]);
      }
      // Recompute "extras" (display-only) from the now-coherent vals.
      const e = deriveExtras(v);
      renderResults(v, e);
    });
  }

  // ─────────────────────────────── wiring ──────────────────────────────────
  function attach() {
    for (const id of Object.keys(FIELDS)) {
      const el = $(id);
      el.addEventListener('focus', () => { activeId = id; });
      el.addEventListener('blur',  () => { if (activeId === id) activeId = null; recompute(); });
      el.addEventListener('input', (ev) => {
        if (!ev.isTrusted) return;
        const raw = el.value.trim();
        if (raw === '') {
          state[id] = 'empty';
          editedAt[id] = 0;
        } else {
          state[id] = 'user';
          editedAt[id] = ++recencyCounter;
        }
        el.classList.remove('auto-filled');
        recompute();
      });
      // Unit selector changes: rewrite the displayed number in the new unit
      // without changing canonical bytes.
      const f = FIELDS[id];
      if (f.kind === 'size') {
        const unitEl = $(f.unitId);
        let lastUnit = unitEl.value;
        unitEl.addEventListener('change', () => {
          const raw = el.value.trim();
          if (raw !== '') {
            const n = Number(raw);
            if (Number.isFinite(n)) {
              const canonical = n * UNITS[lastUnit];
              el.value = formatNum(canonical / UNITS[unitEl.value]);
            }
          }
          lastUnit = unitEl.value;
          recompute();
        });
      }
    }

    $('clearBtn').addEventListener('click', clearAll);
    $('resetBtn').addEventListener('click', clearAll);

    const themeBtn = $('themeToggle');
    const saved = localStorage.getItem('cc-theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon();
    themeBtn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('cc-theme', next);
      updateThemeIcon();
    });

    function updateThemeIcon() {
      const t = document.documentElement.getAttribute('data-theme');
      themeBtn.textContent = t === 'dark' ? '☀️' : '🌙';
    }
  }

  function clearAll() {
    activeId = null;
    recencyCounter = 0;
    for (const id of Object.keys(FIELDS)) {
      const el = $(id);
      el.value = '';
      el.classList.remove('auto-filled');
      state[id] = 'empty';
      editedAt[id] = 0;
    }
    recompute();
  }

  document.addEventListener('DOMContentLoaded', () => {
    attach();
    recompute();
  });
})();
