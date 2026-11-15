/** Bounded GIF89a framing; pixel/LZW decoding stays in the browser's image decoder.
 * Format: https://www.w3.org/Graphics/GIF/spec-gif89a.txt
 */
window.VSC = window.VSC || {};

const GIF_LIMITS = Object.freeze({
  bytes: 8 * 1024 * 1024,
  pixels: 4 * 1024 * 1024,
  framePixels: 16 * 1024 * 1024,
  frames: 240,
  blocks: 65536,
});

function waitForGifWork(promise, signal, disposeLate) {
  return new Promise((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener('abort', aborted);
      reject(signal.reason);
    };
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) {
      aborted();
    }
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', aborted);
        if (signal.aborted) {
          try {
            disposeLate?.(value);
          } catch {
            /* Late native resources are best-effort. */
          }
        } else {
          resolve(value);
        }
      },
      (error) => {
        signal.removeEventListener('abort', aborted);
        reject(error);
      }
    );
  });
}

function parseGif(input) {
  const bytes = new Uint8Array(input);
  if (bytes.length > GIF_LIMITS.bytes) {
    throw new Error('GIF is too large');
  }
  let offset = 0;
  let blocksRead = 0;
  const take = (length) => {
    if (++blocksRead > GIF_LIMITS.blocks) {
      throw new Error('GIF structure exceeds the limit');
    }
    if (offset + length > bytes.length) {
      throw new Error('Truncated GIF');
    }
    const part = bytes.subarray(offset, offset + length);
    offset += length;
    return part;
  };
  const word = (data, index) => data[index] | (data[index + 1] << 8);
  const header = take(13);
  if (!/^GIF8[79]a$/.test(String.fromCharCode(...header.subarray(0, 6)))) {
    throw new Error('Not a GIF');
  }
  const width = word(header, 6),
    height = word(header, 8);
  if (!width || !height || width * height > GIF_LIMITS.pixels) {
    throw new Error('GIF dimensions exceed the limit');
  }
  const palette = take(header[10] & 128 ? 3 * (2 << (header[10] & 7)) : 0);
  const background = palette.subarray(header[11] * 3, header[11] * 3 + 3);
  const blocks = () => {
    while (true) {
      const length = take(1)[0];
      if (!length) {
        return;
      }
      take(length);
    }
  };
  const frames = [];
  let control = new Uint8Array([0x21, 0xf9, 4, 0, 10, 0, 0, 0]);
  let repetitions = null;
  let duration = 0;
  while (true) {
    const marker = take(1)[0];
    if (marker === 0x3b) {
      break;
    }
    if (marker === 0x21) {
      const label = take(1)[0];
      if (label === 0xf9) {
        const data = take(6);
        if (data[0] !== 4 || data[5] !== 0 || data[1] & 2 || ((data[1] >> 2) & 7) > 3) {
          throw new Error('Unsupported GIF control block');
        }
        control = new Uint8Array([0x21, 0xf9, ...data]);
      } else if (label === 0xff) {
        const name = String.fromCharCode(...take(take(1)[0]));
        const start = offset;
        blocks();
        if (name === 'NETSCAPE2.0' || name === 'ANIMEXTS1.0') {
          const data = bytes.subarray(start, offset);
          if (data.length !== 5 || data[0] !== 3 || data[1] !== 1) {
            throw new Error('Invalid GIF loop block');
          }
          repetitions = word(data, 2);
        }
      } else if (label === 0xfe) {
        blocks();
      } else {
        // Plain-text rendering/user input cannot be reproduced as image frames.
        throw new Error('Unsupported GIF extension');
      }
      continue;
    }
    if (marker !== 0x2c) {
      throw new Error('Invalid GIF block');
    }
    const start = offset - 1;
    const descriptor = take(9);
    const left = word(descriptor, 0),
      top = word(descriptor, 2);
    const frameWidth = word(descriptor, 4),
      frameHeight = word(descriptor, 6);
    if (!frameWidth || !frameHeight || left + frameWidth > width || top + frameHeight > height) {
      throw new Error('Invalid GIF frame bounds');
    }
    if (!(header[10] & 128) && !(descriptor[8] & 128)) {
      throw new Error('Missing GIF palette');
    }
    take(descriptor[8] & 128 ? 3 * (2 << (descriptor[8] & 7)) : 0);
    const codeSize = take(1)[0];
    if (codeSize < 2 || codeSize > 8) {
      throw new Error('Invalid GIF code size');
    }
    blocks();
    // Browser GIF timing treats zero/one-centisecond delays as 100ms.
    const rawDelay = word(control, 4);
    const delay = rawDelay < 2 ? 0.1 : rawDelay / 100;
    const frameHeader = header.slice();
    frameHeader[6] = frameWidth & 255;
    frameHeader[7] = frameWidth >> 8;
    frameHeader[8] = frameHeight & 255;
    frameHeader[9] = frameHeight >> 8;
    const image = bytes.slice(start, offset);
    image.fill(0, 1, 5); // Decode a patch at (0, 0), retaining its local palette/interlace.
    const patchControl = control.slice();
    patchControl[3] &= 1; // Only transparency matters to this single-frame image.
    frames.push({
      left,
      top,
      width: frameWidth,
      height: frameHeight,
      disposal: (control[3] >> 2) & 7,
      transparent: Boolean(control[3] & 1),
      start: duration,
      end: duration + delay,
      parts: [frameHeader, palette, patchControl, image, new Uint8Array([0x3b])],
    });
    duration += delay;
    if (
      frames.length > GIF_LIMITS.frames ||
      frames.length * width * height > GIF_LIMITS.framePixels
    ) {
      throw new Error('GIF frame memory exceeds the limit');
    }
    control = new Uint8Array([0x21, 0xf9, 4, 0, 10, 0, 0, 0]);
  }
  return { width, height, frames, duration, repetitions, background };
}

async function readGif(response, signal) {
  if (!response.ok || Number(response.headers.get('content-length')) > GIF_LIMITS.bytes) {
    throw new Error('GIF response unavailable or too large');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await waitForGifWork(reader.read(), signal);
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > GIF_LIMITS.bytes) {
        throw new Error('GIF response exceeds the limit');
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function decodeGif(gif, document, signal) {
  const view = document.defaultView;
  const canvas = document.createElement('canvas');
  canvas.width = gif.width;
  canvas.height = gif.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || typeof view.createImageBitmap !== 'function') {
    throw new Error('GIF decoder unavailable');
  }
  const frames = [];
  let encodedBytes = 0;
  const background = (frame) => {
    context.clearRect(frame.left, frame.top, frame.width, frame.height);
    if (!frame.transparent && gif.background.length === 3) {
      context.fillStyle = `rgb(${gif.background.join(',')})`;
      context.fillRect(frame.left, frame.top, frame.width, frame.height);
    }
  };
  try {
    background({ ...gif.frames[0], left: 0, top: 0, width: gif.width, height: gif.height });
    for (const frame of gif.frames) {
      signal.throwIfAborted();
      const previous =
        frame.disposal === 3 ? context.getImageData(0, 0, gif.width, gif.height) : null;
      const bitmap = await waitForGifWork(
        view.createImageBitmap(new view.Blob(frame.parts, { type: 'image/gif' })),
        signal,
        (late) => late.close()
      );
      try {
        signal.throwIfAborted();
        context.drawImage(bitmap, frame.left, frame.top);
      } finally {
        bitmap.close();
      }
      const blob = await waitForGifWork(
        new Promise((resolve) => canvas.toBlob(resolve, 'image/png')),
        signal
      );
      signal.throwIfAborted();
      if (!blob) {
        throw new Error('Could not render GIF frame');
      }
      encodedBytes += blob.size;
      if (encodedBytes > GIF_LIMITS.bytes * 2) {
        throw new Error('Rendered GIF exceeds the limit');
      }
      frames.push({ start: frame.start, end: frame.end, url: view.URL.createObjectURL(blob) });
      if (previous) {
        context.putImageData(previous, 0, 0);
      } else if (frame.disposal === 2) {
        background(frame);
      }
    }
    return frames;
  } catch (error) {
    for (const frame of frames) {
      view.URL.revokeObjectURL(frame.url);
    }
    throw error;
  } finally {
    canvas.width = canvas.height = 1;
  }
}

window.VSC.GifDecoder = {
  limits: GIF_LIMITS,
  parse: parseGif,
  read: readGif,
  decode: decodeGif,
  wait: waitForGifWork,
};
