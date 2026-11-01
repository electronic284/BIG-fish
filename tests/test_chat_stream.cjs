const assert = require('node:assert/strict');
require('../static/chat-stream.js');

(async () => {
  const events = [
    { type: 'reasoning', content: '先想一想\n<script>不会执行</script>' },
    { type: 'answer', content: '主人，答案。' },
    { type: 'done', content: '' },
  ];
  for (const newline of ['\n', '\r\n']) {
    const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}${newline}${newline}`).join(''));
    for (const size of [1, 3, 23, bytes.length]) {
      const body = new ReadableStream({ start(controller) {
        for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
        controller.close();
      } });
      const result = [];
      for await (const event of readChatEvents(body)) result.push(event);
      assert.deepEqual(result, events);
    }
  }
  await assert.rejects(async () => {
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"ans'));
      controller.close();
    } });
    for await (const event of readChatEvents(body)) void event;
  }, /不完整/);
  console.log('SSE tests passed: UTF-8 splits, batched frames, CRLF and truncated data.');
})().catch(error => { console.error(error); process.exitCode = 1; });
