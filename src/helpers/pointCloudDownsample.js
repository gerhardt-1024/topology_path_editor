export const DEFAULT_DOWNSAMPLE_LEAF_SIZE = 0.03;

export function clampDownsampleLeafSize(value) {
  return Math.max(0.001, Math.min(2, Number(value) || DEFAULT_DOWNSAMPLE_LEAF_SIZE));
}

// Voxel-grid downsample: points sharing a voxel collapse to their centroid,
// mirroring PCL's VoxelGrid filter used to thin dense maps before export.
export function voxelDownsamplePositions(positions, leafSize = DEFAULT_DOWNSAMPLE_LEAF_SIZE) {
  const pointCount = positions ? positions.length / 3 : 0;
  if (!pointCount || !(leafSize > 0)) {
    return positions instanceof Float32Array ? positions : new Float32Array(positions || []);
  }

  const accumulator = createVoxelAccumulator(leafSize);
  accumulator.add(positions);
  const chunks = accumulator.finishChunks();
  const output = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let writeIndex = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, writeIndex);
    writeIndex += chunk.length;
  });
  return output;
}

// Each hash slot is 8 words (32 bytes): int32 ix, iy, iz, count followed by
// float32 sx, sy, sz and one padding word, so a lookup touches one cache line.
const SLOT_WORDS = 8;
// The table is split into shards picked by the hash's top bits because
// Chromium/Electron refuses single ArrayBuffers much above 1 GB; each shard
// grows independently up to that size (2^25 slots * 32 bytes).
const SHARD_BITS = 4;
const INITIAL_SHARD_SLOTS = 1 << 12;
const MAX_SHARD_SLOTS = 1 << 25;

// Incremental voxel grid for streaming input: add() point batches as they are
// read, then finishChunks() returns the voxel centroids as a list of
// Float32Array xyz chunks (one per shard, so no single output buffer has to
// hold every voxel). Voxels live in typed-array open-addressing hash tables
// instead of a JS Map, which caps out at ~16.7M entries and costs far more
// memory per voxel. Per-voxel sums are stored as float32 offsets from the
// voxel's min corner, which stay small and precise regardless of the map's
// absolute coordinates.
export function createVoxelAccumulator(leafSize = DEFAULT_DOWNSAMPLE_LEAF_SIZE) {
  const shards = Array.from({ length: 1 << SHARD_BITS }, () => allocateShard(INITIAL_SHARD_SLOTS));

  // Returns the word index of the slot holding (ix, iy, iz), or of the empty
  // slot where it belongs.
  const findSlot = (ints, slotMask, hash, ix, iy, iz) => {
    let slot = hash & slotMask;
    for (;;) {
      const base = slot * SLOT_WORDS;
      if (ints[base + 3] === 0) return base;
      if (ints[base] === ix && ints[base + 1] === iy && ints[base + 2] === iz) return base;
      slot = (slot + 1) & slotMask;
    }
  };

  const grow = (shardIndex) => {
    const previous = shards[shardIndex];
    if (previous.capacity >= MAX_SHARD_SLOTS) {
      throw new Error('Too many voxels to downsample in memory; increase the downsample leaf size.');
    }
    const next = allocateShard(previous.capacity * 2);
    next.size = previous.size;
    const slotMask = next.capacity - 1;
    const old = previous.ints;
    for (let base = 0; base < old.length; base += SLOT_WORDS) {
      if (old[base + 3] === 0) continue;
      const hash = hashVoxel(old[base], old[base + 1], old[base + 2]);
      const target = findSlot(next.ints, slotMask, hash, old[base], old[base + 1], old[base + 2]);
      next.ints.set(old.subarray(base, base + SLOT_WORDS), target);
    }
    shards[shardIndex] = next;
    return next;
  };

  return {
    add(positions) {
      for (let offset = 0; offset + 2 < positions.length; offset += 3) {
        const x = positions[offset];
        const y = positions[offset + 1];
        const z = positions[offset + 2];
        const ix = Math.floor(x / leafSize) | 0;
        const iy = Math.floor(y / leafSize) | 0;
        const iz = Math.floor(z / leafSize) | 0;
        const hash = hashVoxel(ix, iy, iz);
        const shardIndex = hash >>> (32 - SHARD_BITS);

        let shard = shards[shardIndex];
        let base = findSlot(shard.ints, shard.capacity - 1, hash, ix, iy, iz);
        if (shard.ints[base + 3] === 0) {
          if ((shard.size + 1) * 10 > shard.capacity * 7) {
            shard = grow(shardIndex);
            base = findSlot(shard.ints, shard.capacity - 1, hash, ix, iy, iz);
          }
          shard.ints[base] = ix;
          shard.ints[base + 1] = iy;
          shard.ints[base + 2] = iz;
          shard.size += 1;
        }
        const { ints, floats } = shard;
        ints[base + 3] += 1;
        floats[base + 4] += x - ix * leafSize;
        floats[base + 5] += y - iy * leafSize;
        floats[base + 6] += z - iz * leafSize;
      }
    },

    finishChunks() {
      return shards.map(({ ints, floats, size }) => {
        const output = new Float32Array(size * 3);
        let writeIndex = 0;
        for (let base = 0; base < ints.length; base += SLOT_WORDS) {
          const count = ints[base + 3];
          if (count === 0) continue;
          output[writeIndex] = ints[base] * leafSize + floats[base + 4] / count;
          output[writeIndex + 1] = ints[base + 1] * leafSize + floats[base + 5] / count;
          output[writeIndex + 2] = ints[base + 2] * leafSize + floats[base + 6] / count;
          writeIndex += 3;
        }
        return output;
      });
    },
  };
}

function hashVoxel(ix, iy, iz) {
  let hash = Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  return hash ^ (hash >>> 13);
}

function allocateShard(capacity) {
  const buffer = new ArrayBuffer(capacity * SLOT_WORDS * 4);
  return { capacity, size: 0, ints: new Int32Array(buffer), floats: new Float32Array(buffer) };
}
