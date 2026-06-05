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
      })),
    ),
  };
}

function access(simulator, address, config) {
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
  }

  return { outcome, blockNumber, setIndex, tag, offset, way: line.way };
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

  console.log('simulator mapping checks passed');
})();
