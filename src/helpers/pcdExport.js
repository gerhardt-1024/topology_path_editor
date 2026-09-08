// Binary PCD writer: xyz-only float32 fields, no color/intensity channels.
export function buildBinaryPcdBlob(positions) {
  const pointCount = positions.length / 3;
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
  const bodyBytes = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength);

  return new Blob([headerBytes, bodyBytes], { type: 'application/octet-stream' });
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
