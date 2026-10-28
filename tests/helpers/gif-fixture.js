/** Tiny deterministic GIFs. Clear before every literal keeps LZW codes at 3 bits. */
export function gifFixture({
  width = 4,
  height = 4,
  loop = 0,
  frames = [
    { color: 1, delay: 20 },
    { color: 2, delay: 30 },
  ],
} = {}) {
  const bytes = [
    ...new TextEncoder().encode('GIF89a'),
    width,
    0,
    height,
    0,
    0x81,
    0,
    0,
    0,
    0,
    0,
    255,
    0,
    0,
    0,
    0,
    255,
    0,
    255,
    0,
  ];
  if (loop !== null) {
    bytes.push(
      0x21,
      0xff,
      11,
      ...new TextEncoder().encode('NETSCAPE2.0'),
      3,
      1,
      loop & 255,
      loop >> 8,
      0
    );
  }
  for (const frame of frames) {
    const w = frame.width || width,
      h = frame.height || height;
    const flags = ((frame.disposal || 0) << 2) | (frame.transparent ? 1 : 0);
    bytes.push(
      0x21,
      0xf9,
      4,
      flags,
      frame.delay & 255,
      frame.delay >> 8,
      0,
      0,
      0x2c,
      frame.left || 0,
      0,
      frame.top || 0,
      0,
      w,
      0,
      h,
      0,
      frame.interlaced ? 64 : 0,
      2
    );
    const codes = [];
    for (let index = 0; index < w * h; index++) {
      codes.push(4, frame.pixels?.[index] ?? frame.color);
    }
    codes.push(5);
    let buffer = 0,
      bits = 0;
    const data = [];
    for (const code of codes) {
      buffer |= code << bits;
      bits += 3;
      if (bits >= 8) {
        data.push(buffer & 255);
        buffer >>= 8;
        bits -= 8;
      }
    }
    if (bits) {
      data.push(buffer & 255);
    }
    for (let offset = 0; offset < data.length; offset += 255) {
      const part = data.slice(offset, offset + 255);
      bytes.push(part.length, ...part);
    }
    bytes.push(0);
  }
  return new Uint8Array([...bytes, 0x3b]);
}
