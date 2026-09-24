// Binary PCD writer: xyz-only float32 fields, no color/intensity channels.
// Accepts one Float32Array or a list of them, so very large maps can be written
// without concatenating every point into a single buffer.
export function buildBinaryPcdBlob(positions) {
  const chunks = Array.isArray(positions) ? positions : [positions];
  const pointCount = chunks.reduce((total, chunk) => total + chunk.length, 0) / 3;
  const header =
    '# .PCD v0.7 - Point Cloud Data file format\n' +
    'VERSION 0.7\n' +
    'FIELDS x y z\n' +
    'SIZE 4 4 4\n' +
    'TYPE F F F\n' +
    'COUNT 1 1 1\n' +
    `WIDTH ${pointCount}\n` +
    'HEIGHT 1\n' +
    'VIEWPOINT 0 0 0 1 0 0 0\n' +
    `POINTS ${pointCount}\n` +
    'DATA binary\n';

  const headerBytes = new TextEncoder().encode(header);
  const bodyParts = chunks.map((chunk) => new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));

  return new Blob([headerBytes, ...bodyParts], { type: 'application/octet-stream' });
}

export function downloadBinaryPcd(positions, fileName = 'map.pcd') {
  const blob = buildBinaryPcdBlob(positions);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
