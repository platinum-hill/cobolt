const { TextDecoder, TextEncoder, ReadableStream } = require('node:util');

/* eslint-disable no-undef */
Object.defineProperties(globalThis, {
  TextDecoder: { value: TextDecoder },
  TextEncoder: { value: TextEncoder },
  ReadableStream: { value: ReadableStream },
});
