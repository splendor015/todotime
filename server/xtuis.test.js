import test from 'node:test';
import assert from 'node:assert/strict';
import { createXtuisSender, xtuisBody } from './xtuis.js';

const response = (payload, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: name => headers[name.toLowerCase()] || headers[name] || null },
  text: async () => JSON.stringify(payload)
});

test('xtuis sender encodes content and returns message id without exposing token', async () => {
  let requested;
  const sender = createXtuisSender({
    token: 'secret/token',
    baseUrl: 'https://push.example',
    fetchImpl: async (url, options) => {
      requested = { url, options };
      return response({ code: 200, data: { msg_id: 'wx_123' } });
    }
  });
  const result = await sender({ title: '日程 & 提醒', body: '今晚 19:00\n健身' });
  const url = new URL(requested.url);
  assert.equal(url.pathname, '/secret%2Ftoken.send');
  assert.equal(url.searchParams.get('text'), '日程 & 提醒');
  assert.equal(url.searchParams.get('desp'), '今晚 19:00 健身');
  assert.equal(requested.options.method, 'GET');
  assert.equal(result.messageId, 'wx_123');
});

test('xtuis sender reports rate limit retry delay', async () => {
  const sender = createXtuisSender({
    token: 'secret',
    fetchImpl: async () => response({ code: 429, msg: 'too many', retry_after_seconds: 12 }, 429, { 'retry-after': '12' })
  });
  await assert.rejects(sender({ title: 'test' }), error => error.status === 429 && error.retryAfter === 12);
});

test('xtuis message body includes public TodoTime link', () => {
  assert.equal(xtuisBody({ body: '日程已更新' }, 'https://todotime.me/'), '日程已更新\n\n打开 TodoTime：https://todotime.me');
});
