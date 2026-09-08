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

  const voxels = new Map();

  for (let index = 0; index < pointCount; index += 1) {
    const offset = index * 3;
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    const key = `${Math.floor(x / leafSize)}_${Math.floor(y / leafSize)}_${Math.floor(z / leafSize)}`;

    const voxel = voxels.get(key);
    if (voxel) {
      voxel.x += x;
      voxel.y += y;
      voxel.z += z;
      voxel.count += 1;
    } else {
      voxels.set(key, { x, y, z, count: 1 });
    }
  }

  const output = new Float32Array(voxels.size * 3);
  let writeIndex = 0;
  voxels.forEach((voxel) => {
    output[writeIndex] = voxel.x / voxel.count;
    output[writeIndex + 1] = voxel.y / voxel.count;
    output[writeIndex + 2] = voxel.z / voxel.count;
    writeIndex += 3;
  });

  return output;
}
