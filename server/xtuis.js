import https from 'node:https';

const DEFAULT_BASE_URL = 'https://wx.xtuis.cn';

const clean = (value, maxLength) => String(value || '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLength);

const errorMessage = (payload, fallback) => {
  if (!payload || typeof payload !== 'object') return fallback;
  return clean(payload.msg || payload.message || payload.error || fallback, 180);
};

const requestWithHttps = (url, options = {}, redirects = 0) => new Promise((resolve, reject) => {
  const request = https.get(url, { headers: options.headers }, response => {
    const location = response.headers.location;
    if (location && response.statusCode >= 300 && response.statusCode < 400 && redirects < 3) {
      response.resume();
      cleanup();
      requestWithHttps(new URL(location, url).toString(), options, redirects + 1).then(resolve, reject);
      return;
    }
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => {
      cleanup();
      const status = Number(response.statusCode || 0);
      resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: name => response.headers[String(name).toLowerCase()] || null },
        text: async () => Buffer.concat(chunks).toString('utf8')
      });
    });
  });
  const cleanup = () => options.signal?.removeEventListener('abort', abort);
  const abort = () => {
    const error = new Error('request aborted');
    error.name = 'AbortError';
    request.destroy(error);
  };
  request.on('error', error => { cleanup(); reject(error); });
  if (options.signal) {
    if (options.signal.aborted) abort();
    else options.signal.addEventListener('abort', abort, { once: true });
  }
});

export function createXtuisSender({
  token,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch || requestWithHttps,
  timeoutMs = 8000
} = {}) {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) return null;
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node.js 运行时不支持 HTTPS 请求');

  return async function sendXtuis({ title, body = '' }) {
    const params = new URLSearchParams({ text: clean(title, 80) || 'TodoTime 通知' });
    const description = clean(body, 1800);
    if (description) params.set('desp', description);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(normalizedToken)}.send?${params}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('虾推啥请求超时');
      throw new Error('无法连接虾推啥服务');
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { /* non-JSON response */ }
    const code = payload?.code ?? payload?.status;
    const rejectedByPayload = code !== undefined && ![0, 1, 200, '0', '1', '200', 'success'].includes(code);
    if (!response.ok || rejectedByPayload) {
      const error = new Error(errorMessage(payload, `虾推啥返回 HTTP ${response.status}`));
      error.status = response.status;
      error.retryAfter = Number(response.headers.get('retry-after') || payload?.retry_after_seconds || 0) || null;
      throw error;
    }
    return {
      messageId: payload?.msg_id || payload?.data?.msg_id || payload?.data?.id || null,
      response: payload
    };
  };
}

export function xtuisBody(notification, publicUrl = '') {
  const parts = [notification.body];
  if (publicUrl) parts.push(`打开 TodoTime：${publicUrl.replace(/\/$/, '')}`);
  return parts.filter(Boolean).join('\n\n');
}
