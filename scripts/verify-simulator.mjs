function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createSimulator(config) {
  return {
    replacement: Array.from({ length: config.numSets }, () => 0),
    lines: Array.from({ length: config.numSets }, () =>
      Array.from({ length: config.associativity }, (_, way) => ({
        way,
        valid: false,
        tag: null,
        blockNumber: null,
        baseAddress: null,
        dirty: false,
      })),
    ),
    tlb: Array.from({ length: config.tlbRows || 0 }, (_, index) => ({
      index,
      valid: false,
      tag: null,
      vpn: null,
      physicalPage: null,
    })),
  };
}

function access(simulator, address, config, operation = 'read') {
  const blockNumber = Math.floor(address / config.blockSize);
  const setIndex = blockNumber % config.numSets;
  const tag = Math.floor(blockNumber / config.numSets);
  const offset = address % config.blockSize;
  const set = simulator.lines[setIndex];

  let line = set.find((entry) => entry.valid && entry.tag === tag);
  let outcome = 'Hit';
  if (!line) {
    outcome = 'Miss';
    line = set.find((entry) => !entry.valid);
    if (!line) {
      line = set[simulator.replacement[setIndex] % set.length];
      simulator.replacement[setIndex] = (simulator.replacement[setIndex] + 1) % set.length;
    }
    line.valid = true;
    line.tag = tag;
    line.blockNumber = blockNumber;
    line.baseAddress = blockNumber * config.blockSize;
    line.dirty = false;
  }
  if (operation === 'write') {
    line.dirty = true;
  }

  return { outcome, blockNumber, setIndex, tag, offset, way: line.way, dirty: line.dirty };
}

function translateVirtual(simulator, address, config) {
  const vpn = Math.floor(address / config.pageSize);
  const pageOffset = address % config.pageSize;
  const tlbIndex = vpn % config.tlbRows;
  const tlbTag = Math.floor(vpn / config.tlbRows);
  const entry = simulator.tlb[tlbIndex];
  const tlbHit = entry.valid && entry.tag === tlbTag;
  const physicalPage = tlbHit ? entry.physicalPage : (vpn % config.physicalPages);
  if (!tlbHit) {
    entry.valid = true;
    entry.tag = tlbTag;
    entry.vpn = vpn;
    entry.physicalPage = physicalPage;
  }
  return {
    vpn,
    pageOffset,
    tlbIndex,
    tlbTag,
    tlbHit,
    physicalPage,
    physicalAddress: (physicalPage * config.pageSize) + pageOffset,
  };
}

(function run() {
  const directMapped = {
    blockSize: 16,
    numSets: 8,
    associativity: 1,
  };
  const directSim = createSimulator(directMapped);
  const first = access(directSim, 0x3F, directMapped);
  assert(first.outcome === 'Miss', 'first direct-mapped access should miss');
  assert(first.blockNumber === 3, '0x3F should map to block 3');
  assert(first.setIndex === 3, '0x3F should map to set 3');
  assert(first.tag === 0, '0x3F should have tag 0');
  assert(first.offset === 15, '0x3F should have offset 15');

  const second = access(directSim, 0x38, directMapped);
  assert(second.outcome === 'Hit', 'second access to same block should hit');
  assert(second.setIndex === 3, '0x38 should remain in set 3');
  assert(second.tag === 0, '0x38 should still have tag 0');

  const writeHit = access(directSim, 0x38, directMapped, 'write');
  assert(writeHit.dirty === true, 'write access should mark the cache line dirty');

  const third = access(directSim, 0xB8, directMapped);
  assert(third.outcome === 'Miss', 'different tag in same set should miss');
  assert(third.setIndex === 3, '0xB8 should map to set 3');
  assert(third.tag === 1, '0xB8 should map to tag 1');

  const setAssociative = {
    blockSize: 16,
    numSets: 4,
    associativity: 2,
  };
  const assocSim = createSimulator(setAssociative);
  const a = access(assocSim, 0x00, setAssociative);
  const b = access(assocSim, 0x40, setAssociative);
  const c = access(assocSim, 0x80, setAssociative);
  assert(a.setIndex === 0 && b.setIndex === 0 && c.setIndex === 0, 'all three addresses should map to set 0');
  assert(a.tag === 0 && b.tag === 1 && c.tag === 2, 'tags should increase by block group');
  assert(assocSim.lines[0].every((line) => line.valid), 'two-way set should be full after two fills');
  assert(c.outcome === 'Miss', 'third unique block in same set should miss and replace');

  const virtualConfig = {
    pageSize: 16 * 1024,
    physicalPages: 2,
    tlbRows: 4,
  };
  const virtualAddress = 0x4500;
  const virtualSim = createSimulator({ numSets: 1, associativity: 1, tlbRows: virtualConfig.tlbRows });
  const firstTranslation = translateVirtual(virtualSim, virtualAddress, virtualConfig);
  assert(firstTranslation.vpn === 1, '0x4500 should translate to VPN 1 with 16KB pages');
  assert(firstTranslation.pageOffset === 0x500, '0x4500 should have page offset 0x500');
  assert(firstTranslation.physicalPage === 1, 'VPN 1 should map to physical page 1 in the demo translation');
  assert(firstTranslation.physicalAddress === 0x4500, 'demo translation should preserve 0x4500 for VPN 1 with two physical pages');
  assert(firstTranslation.tlbHit === false, 'first virtual lookup should miss in the TLB');

  const secondTranslation = translateVirtual(virtualSim, virtualAddress, virtualConfig);
  assert(secondTranslation.tlbHit === true, 'second virtual lookup should hit in the TLB');

  console.log('simulator mapping checks passed');
})();
