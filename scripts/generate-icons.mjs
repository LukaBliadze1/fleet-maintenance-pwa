import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const sourceSize = 512;
const pixels = new Uint8Array(sourceSize * sourceSize * 4);
const colors = {
  background: [17, 26, 36, 255],
  transparent: [17, 26, 36, 0],
  orange: [232, 137, 54, 255],
  light: [244, 246, 248, 255]
};

function setPixel(x, y, color) {
  if (x < 0 || y < 0 || x >= sourceSize || y >= sourceSize) return;
  pixels.set(color, (y * sourceSize + x) * 4);
}

function fillCircle(cx, cy, radius, color) {
  const radiusSquared = radius * radius;
  for (let y = Math.max(0, cy - radius); y <= Math.min(sourceSize - 1, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(sourceSize - 1, cx + radius); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radiusSquared) setPixel(x, y, color);
    }
  }
}

function fillPolygon(points, color) {
  const minX = Math.max(0, Math.floor(Math.min(...points.map(([x]) => x))));
  const maxX = Math.min(sourceSize - 1, Math.ceil(Math.max(...points.map(([x]) => x))));
  const minY = Math.max(0, Math.floor(Math.min(...points.map(([, y]) => y))));
  const maxY = Math.min(sourceSize - 1, Math.ceil(Math.max(...points.map(([, y]) => y))));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (crosses) inside = !inside;
      }
      if (inside) setPixel(x, y, color);
    }
  }
}

for (let y = 0; y < sourceSize; y += 1) {
  for (let x = 0; x < sourceSize; x += 1) {
    const radius = 105;
    const nearestX = Math.max(radius, Math.min(sourceSize - radius - 1, x));
    const nearestY = Math.max(radius, Math.min(sourceSize - radius - 1, y));
    const inside = (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
    setPixel(x, y, inside ? colors.background : colors.transparent);
  }
}

fillPolygon(
  [
    [137, 221],
    [320, 221],
    [367, 276],
    [367, 326],
    [123, 326],
    [123, 278]
  ],
  colors.orange
);
fillPolygon(
  [
    [159, 217],
    [188, 171],
    [320, 171],
    [344, 217]
  ],
  colors.light
);
fillPolygon(
  [
    [196, 187],
    [308, 187],
    [326, 217],
    [181, 217]
  ],
  colors.background
);
fillCircle(177, 337, 39, colors.light);
fillCircle(177, 337, 20, colors.background);
fillCircle(345, 337, 39, colors.light);
fillCircle(345, 337, 20, colors.background);
fillPolygon(
  [
    [387, 181],
    [410, 181],
    [410, 340],
    [387, 340]
  ],
  colors.orange
);
fillPolygon(
  [
    [370, 327],
    [420, 327],
    [420, 341],
    [370, 341]
  ],
  colors.light
);

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function createPng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const targetRow = y * (size * 4 + 1);
    raw[targetRow] = 0;
    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.min(sourceSize - 1, Math.floor((x * sourceSize) / size));
      const sourceY = Math.min(sourceSize - 1, Math.floor((y * sourceSize) / size));
      const sourceOffset = (sourceY * sourceSize + sourceX) * 4;
      raw.set(pixels.subarray(sourceOffset, sourceOffset + 4), targetRow + 1 + x * 4);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

for (const size of [180, 192, 512]) {
  await writeFile(new URL(`../public/pwa-icon-${size}.png`, import.meta.url), createPng(size));
}
