export const DEFAULT_DISPLAY_MAX_POINTS = 250000;
export const MIN_DISPLAY_MAX_POINTS = 10000;
export const MAX_DISPLAY_MAX_POINTS = 20000000;
const PCD_HEADER_PREVIEW_BYTES = 65536;
// Binary PCD bodies are streamed in slices of this size so multi-GB maps never
// have to fit into a single ArrayBuffer.
const PCD_CHUNK_BYTES = 64 * 1024 * 1024;

const textDecoder = new TextDecoder();

export function clampDisplayMaxPoints(value) {
  const points = Math.round(Number(value) || DEFAULT_DISPLAY_MAX_POINTS);
  return Math.max(MIN_DISPLAY_MAX_POINTS, Math.min(MAX_DISPLAY_MAX_POINTS, points));
}

export async function parseMapFile(file, options = {}) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const maxPoints = options.maxPoints || DEFAULT_DISPLAY_MAX_POINTS;

  if (extension === 'pcd') {
    const pcd = await readPcdHeader(file);
    if (pcd.dataType === 'binary') {
      return parsePcdBinaryFile(file, pcd, maxPoints, options);
    }
    const buffer = await file.arrayBuffer();
    return parsePcd(buffer, pcd, file.name, maxPoints);
  }

  if (extension === 'ply') {
    const text = await file.text();
    return parseAsciiPly(text, file.name, maxPoints);
  }

  if (['xyz', 'txt', 'csv'].includes(extension)) {
    const text = await file.text();
    return parseDelimitedPoints(text, file.name, maxPoints);
  }

  throw new Error(`Unsupported map format ".${extension}". Load PCD, ASCII PLY, XYZ, TXT, or CSV.`);
}

// Feeds every point of a map file to onChunk as Float32Array xyz batches, so
// full-resolution consumers (map export) never hold the whole cloud at once.
export async function forEachMapPointChunk(file, onChunk, options = {}) {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'pcd') {
    const pcd = await readPcdHeader(file);
    if (pcd.dataType === 'binary') {
      await streamPcdBinaryPoints(file, pcd, 1, onChunk, options);
      return;
    }
  }

  const parsed = await parseMapFile(file, { maxPoints: Infinity });
  onChunk(parsed.positions);
}

async function readPcdHeader(file) {
  const previewBuffer = await file.slice(0, PCD_HEADER_PREVIEW_BYTES).arrayBuffer();
  const headerPreview = textDecoder.decode(previewBuffer);
  const dataMatch = headerPreview.match(/DATA\s+(ascii|binary|binary_compressed)\s*(?:\r?\n)/i);

  if (!dataMatch) {
    throw new Error('Invalid PCD: DATA header was not found.');
  }

  const headerEnd = dataMatch.index + dataMatch[0].length;
  return {
    dataType: dataMatch[1].toLowerCase(),
    headerEnd,
    header: parsePcdHeader(headerPreview.slice(0, headerEnd)),
  };
}

function parsePcd(buffer, { dataType, headerEnd, header }, name, maxPoints) {
  if (dataType === 'ascii') {
    const body = textDecoder.decode(buffer.slice(headerEnd));
    return parsePcdAsciiBody(body, header, name, maxPoints);
  }

  return parsePcdBinaryCompressedBody(buffer, headerEnd, header, name, maxPoints);
}

function parsePcdHeader(headerText) {
  const header = {};
  headerText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .forEach((line) => {
      const [key, ...values] = line.split(/\s+/);
      header[key.toUpperCase()] = values;
    });

  const fields = header.FIELDS || [];
  const size = (header.SIZE || []).map(Number);
  const type = header.TYPE || [];
  const count = header.COUNT ? header.COUNT.map(Number) : fields.map(() => 1);
  const points = Number(header.POINTS?.[0] || header.WIDTH?.[0] || 0);

  if (!fields.includes('x') || !fields.includes('y') || !fields.includes('z')) {
    throw new Error('PCD must include x, y, and z fields.');
  }

  let offset = 0;
  const offsets = {};
  fields.forEach((field, index) => {
    offsets[field] = offset;
    offset += (size[index] || 4) * (count[index] || 1);
  });

  return { fields, size, type, count, points, offsets, rowSize: offset };
}

function parsePcdAsciiBody(body, header, name, maxPoints) {
  const lines = body.split(/\r?\n/).filter(Boolean);
  const total = header.points || lines.length;
  const stride = Math.max(1, Math.ceil(total / maxPoints));
  const xIndex = header.fields.indexOf('x');
  const yIndex = header.fields.indexOf('y');
  const zIndex = header.fields.indexOf('z');
  const positions = [];

  for (let index = 0; index < lines.length; index += stride) {
    const values = lines[index].trim().split(/\s+/);
    const x = Number(values[xIndex]);
    const y = Number(values[yIndex]);
    const z = Number(values[zIndex]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      positions.push(x, y, z);
    }
  }

  return buildMapData(positions, name, 'PCD ASCII', total);
}

async function parsePcdBinaryFile(file, pcd, maxPoints, options) {
  const total = pcd.header.points || Math.floor((file.size - pcd.headerEnd) / pcd.header.rowSize);
  const stride = Math.max(1, Math.ceil(total / maxPoints));
  const positions = new Float32Array(Math.ceil(total / stride) * 3);
  let length = 0;

  await streamPcdBinaryPoints(file, pcd, stride, (chunk) => {
    positions.set(chunk, length);
    length += chunk.length;
  }, options);

  return buildMapData(positions.slice(0, length), file.name, 'PCD Binary', total);
}

// Reads the binary PCD body slice by slice, decoding every stride-th row and
// handing each slice's finite points to onChunk. isCancelled() is polled
// between slices so a superseded multi-GB read stops early.
async function streamPcdBinaryPoints(file, { headerEnd, header }, stride, onChunk, { onProgress, isCancelled } = {}) {
  const { rowSize } = header;
  const storedRows = Math.floor((file.size - headerEnd) / rowSize);
  const rowCount = Math.min(header.points || storedRows, storedRows);
  const rowsPerChunk = Math.max(1, Math.floor(PCD_CHUNK_BYTES / rowSize));
  const readers = ['x', 'y', 'z'].map((field) => {
    const fieldIndex = header.fields.indexOf(field);
    return {
      offset: header.offsets[field],
      type: header.type[fieldIndex],
      size: header.size[fieldIndex],
    };
  });
  const [xReader, yReader, zReader] = readers;

  for (let startRow = 0; startRow < rowCount; startRow += rowsPerChunk) {
    if (isCancelled?.()) throw new Error('Map loading was cancelled.');
    const endRow = Math.min(rowCount, startRow + rowsPerChunk);
    const buffer = await file
      .slice(headerEnd + startRow * rowSize, headerEnd + endRow * rowSize)
      .arrayBuffer();
    const view = new DataView(buffer);
    const firstRow = Math.ceil(startRow / stride) * stride;
    const positions = new Float32Array(Math.max(0, Math.ceil((endRow - firstRow) / stride)) * 3);
    let writeIndex = 0;

    for (let row = firstRow; row < endRow; row += stride) {
      const rowOffset = (row - startRow) * rowSize;
      const x = readPcdScalar(view, rowOffset + xReader.offset, xReader.type, xReader.size);
      const y = readPcdScalar(view, rowOffset + yReader.offset, yReader.type, yReader.size);
      const z = readPcdScalar(view, rowOffset + zReader.offset, zReader.type, zReader.size);

      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        positions[writeIndex] = x;
        positions[writeIndex + 1] = y;
        positions[writeIndex + 2] = z;
        writeIndex += 3;
      }
    }

    onChunk(positions.subarray(0, writeIndex));
    onProgress?.(endRow / rowCount);
  }
}

function parsePcdBinaryCompressedBody(buffer, headerEnd, header, name, maxPoints) {
  const sizesView = new DataView(buffer, headerEnd);
  const compressedSize = sizesView.getUint32(0, true);
  const uncompressedSize = sizesView.getUint32(4, true);
  const compressed = new Uint8Array(buffer, headerEnd + 8, compressedSize);
  const decompressed = lzfDecompress(compressed, uncompressedSize);
  const view = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);

  const total = header.points || 0;
  const stride = Math.max(1, Math.ceil(total / maxPoints));

  // Compressed PCD stores fields as a "structure of arrays": every field's
  // values are packed contiguously (all x, then all y, ...), unlike the
  // per-point interleaved layout used by plain binary PCD.
  let fieldStart = 0;
  const fieldOffsets = {};
  header.fields.forEach((field, index) => {
    fieldOffsets[field] = fieldStart;
    fieldStart += (header.size[index] || 4) * (header.count[index] || 1) * total;
  });

  const xField = header.fields.indexOf('x');
  const yField = header.fields.indexOf('y');
  const zField = header.fields.indexOf('z');
  const xSize = header.size[xField] || 4;
  const ySize = header.size[yField] || 4;
  const zSize = header.size[zField] || 4;
  const positions = [];

  for (let pointIndex = 0; pointIndex < total; pointIndex += stride) {
    const x = readPcdScalar(view, fieldOffsets.x + pointIndex * xSize, header.type[xField], xSize);
    const y = readPcdScalar(view, fieldOffsets.y + pointIndex * ySize, header.type[yField], ySize);
    const z = readPcdScalar(view, fieldOffsets.z + pointIndex * zSize, header.type[zField], zSize);

    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      positions.push(x, y, z);
    }
  }

  return buildMapData(positions, name, 'PCD Binary Compressed', total);
}

// Decompresses PCL's binary_compressed PCD payload, which uses the liblzf
// framing (as written by pcl::io::LZFCompress): literal runs and
// back-references packed into a single control-byte stream.
function lzfDecompress(input, expectedLength) {
  const output = new Uint8Array(expectedLength);
  let ip = 0;
  let op = 0;

  while (ip < input.length) {
    let ctrl = input[ip++];

    if (ctrl < (1 << 5)) {
      ctrl++;
      if (op + ctrl > expectedLength) {
        throw new Error('Invalid PCD: binary_compressed literal run overflows output buffer.');
      }
      for (let i = 0; i < ctrl; i++) {
        output[op++] = input[ip++];
      }
    } else {
      let len = ctrl >> 5;
      let ref = op - ((ctrl & 0x1f) << 8) - 1;

      if (len === 7) {
        len += input[ip++];
      }

      ref -= input[ip++];

      if (ref < 0) {
        throw new Error('Invalid PCD: binary_compressed back-reference precedes output start.');
      }
      if (op + len + 2 > expectedLength) {
        throw new Error('Invalid PCD: binary_compressed back-reference overflows output buffer.');
      }

      output[op++] = output[ref++];
      output[op++] = output[ref++];
      for (let i = 0; i < len; i++) {
        output[op++] = output[ref++];
      }
    }
  }

  return output;
}

function readPcdScalar(view, offset, type = 'F', size = 4) {
  const littleEndian = true;
  if (type === 'F') {
    return size === 8 ? view.getFloat64(offset, littleEndian) : view.getFloat32(offset, littleEndian);
  }
  if (type === 'I') {
    if (size === 1) return view.getInt8(offset);
    if (size === 2) return view.getInt16(offset, littleEndian);
    if (size === 4) return view.getInt32(offset, littleEndian);
  }
  if (type === 'U') {
    if (size === 1) return view.getUint8(offset);
    if (size === 2) return view.getUint16(offset, littleEndian);
    if (size === 4) return view.getUint32(offset, littleEndian);
  }
  return NaN;
}

function parseAsciiPly(text, name, maxPoints) {
  const headerEnd = text.indexOf('end_header');
  if (headerEnd === -1) throw new Error('Invalid PLY: end_header was not found.');

  const headerText = text.slice(0, headerEnd);
  if (!/format\s+ascii/i.test(headerText)) {
    throw new Error('Only ASCII PLY is supported by this lightweight loader.');
  }

  const vertexMatch = headerText.match(/element\s+vertex\s+(\d+)/i);
  const vertexCount = Number(vertexMatch?.[1] || 0);
  const propertyLines = headerText
    .split(/\r?\n/)
    .filter((line) => /^property\s+/i.test(line.trim()))
    .map((line) => line.trim().split(/\s+/).pop());
  const xIndex = propertyLines.indexOf('x');
  const yIndex = propertyLines.indexOf('y');
  const zIndex = propertyLines.indexOf('z');
  if (xIndex === -1 || yIndex === -1 || zIndex === -1) {
    throw new Error('PLY must include x, y, and z vertex properties.');
  }

  const body = text.slice(headerEnd + 'end_header'.length).trim();
  const lines = body.split(/\r?\n/).slice(0, vertexCount || undefined);
  const stride = Math.max(1, Math.ceil(lines.length / maxPoints));
  const positions = [];

  for (let index = 0; index < lines.length; index += stride) {
    const values = lines[index].trim().split(/\s+/);
    const x = Number(values[xIndex]);
    const y = Number(values[yIndex]);
    const z = Number(values[zIndex]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      positions.push(x, y, z);
    }
  }

  return buildMapData(positions, name, 'ASCII PLY', lines.length);
}

function parseDelimitedPoints(text, name, maxPoints) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const stride = Math.max(1, Math.ceil(rows.length / maxPoints));
  const positions = [];

  for (let index = 0; index < rows.length; index += stride) {
    const values = rows[index].split(/[,\s]+/).map(Number);
    const [x, y, z = 0] = values;
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      positions.push(x, y, z);
    }
  }

  return buildMapData(positions, name, 'Delimited XYZ', rows.length);
}

function buildMapData(positions, name, format, originalCount) {
  return {
    name,
    format,
    originalCount,
    sampledCount: positions.length / 3,
    positions: positions instanceof Float32Array ? positions : new Float32Array(positions),
  };
}
