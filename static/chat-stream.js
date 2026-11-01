'use strict';

// SSE frames can span network chunks, including in the middle of a UTF-8 character.
globalThis.readChatEvents = async function* (body) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart()).join('\n');
        if (data) yield JSON.parse(data);
      }
      if (done) {
        if (buffer.trim()) throw new Error('回复数据不完整');
        return;
      }
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
};
