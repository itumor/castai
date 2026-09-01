// Minimal CAST AI HTTP client wrapper built on Node fetch.
//
// Responsibilities:
//   - Configurable base URL (defaults to EU region).
//   - Inject Authorization: Token <CASTAI_API_KEY> header (CAST AI
//     standard auth shape; see https://docs.cast.ai/reference/api).
//   - Optionally inject X-Organization-Id when an org is bound.
//   - Throw a typed CastaiApiError on non-2xx responses.
//
// This client is the single point that talks to api.cast.ai. All
// upstream calls from MCP tools go through here so that the read-only
// policy gate (see server.js) can enforce method / path rules before
// the request is even constructed.

// Keys whose string values must be masked when an error is serialized
// or stringified. Used by CastaiApiError to scrub its `message` and
// `body` so credentials never leak through stack traces or logs.
const SENSITIVE_KEYS = new Set([
  'apikey',
  'api_key',
  'api-key',
  'token',
  'accesstoken',
  'access_token',
  'access-token',
  'authtoken',
  'auth_token',
  'auth-token',
  'password',
  'secret',
  'clientsecret',
  'client_secret',
  'client-secret'
]);

function scrubValue(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.stringify(scrubValue(JSON.parse(trimmed)));
      } catch (_) {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrubValue(v));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(String(k).toLowerCase()) && typeof v === 'string') {
        out[k] = '[REDACTED]';
      } else {
        out[k] = scrubValue(v);
      }
    }
    return out;
  }
  return value;
}

function scrubMessage(msg) {
  if (msg == null) return msg;
  let s = String(msg);
  s = s.replace(/Authorization:\s*Token\s+[A-Za-z0-9._\-\[\]]+/gi, 'Authorization: Token [REDACTED]');
  s = s.replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._\-\[\]]+/gi, 'Authorization: Bearer [REDACTED]');
  s = s.replace(/X-API-Key[\s:]+[A-Za-z0-9._\-\[\]]+/gi, 'X-API-Key: [REDACTED]');
  s = s.replace(/Token\s+[A-Za-z0-9._\-\[\]]+/g, 'Token [REDACTED]');
  s = s.replace(/Bearer\s+[A-Za-z0-9._\-\[\]]+/g, 'Bearer [REDACTED]');
  s = s.replace(/castai_v1_[A-Za-z0-9._\-\[\]]+/g, 'castai_v1_[REDACTED]');
  s = s.replace(/\bapi[_-]?key[\s]*[=:][\s]*[A-Za-z0-9._\-\[\]]+/gi, 'api_key=[REDACTED]');
  const walked = scrubValue(s);
  if (typeof walked === 'string') return walked;
  try {
    return JSON.stringify(walked);
  } catch (_) {
    return s;
  }
}

export class CastaiApiError extends Error {
  constructor(message, { status, body, url, method } = {}) {
    super(scrubMessage(message));
    this.name = 'CastaiApiError';
    this.status = status;
    // Scrub the body too so accidental .body inspection or JSON
    // serialization of the error object does not leak secrets.
    this.body = scrubValue(body);
    this.url = url;
    this.method = method;
  }
}

// Helper to create an AbortSignal that fires after `ms` milliseconds.
function timeoutSignal(ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  // Deno/Node expose different shapes; returning the signal is enough for fetch.
  const signal = controller.signal;
  signal.__cleanup = () => clearTimeout(id);
  return signal;
}

export class CastaiClient {
  constructor({
    apiKey,
    baseUrl,
    orgId,
    fetchImpl,
    timeoutMs = 30000,
    maxRetries = 3
  } = {}) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('CastaiClient: apiKey is required');
    }
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || 'https://api.eu.cast.ai').replace(/\/+$/, '');
    this.orgId = orgId || null;
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000;
    this.maxRetries = Number.isFinite(maxRetries) && maxRetries >= 0 ? maxRetries : 3;
    // Allow injection for tests; Node 18+ ships a global fetch.
    this.fetchImpl = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('CastaiClient: no fetch implementation available (need Node >=18)');
    }
  }

  _headers(extra) {
    const headers = {
      Authorization: `Token ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': 'castai-mcp-server/0.1.0'
    };
    if (this.orgId) {
      headers['X-Organization-Id'] = this.orgId;
    }
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (v !== undefined && v !== null) headers[k] = String(v);
      }
    }
    return headers;
  }

  // Public read method. The only method the server is allowed to call
  // in step-1 scaffold. Any future mutating method must go through an
  // approval gate and a separate (currently unimplemented) method here.
  async get(path, { query } = {}) {
    return this._request('GET', path, { query });
  }

  // Mutating helper used by the example `delete_cluster` tool to
  // exercise the approval gate. The underlying `_request` rejects all
  // non-GET methods with a typed CastaiApiError, which the tool handler
  // surfaces as a normal `isError: true` result.
  async delete(path, { query } = {}) {
    return this._request('DELETE', path, { query });
  }

  async _request(method, path, { query, body } = {}) {
    if (method !== 'GET') {
      // Defence in depth: even if a future caller forgets the policy
      // gate, this client refuses non-GET upstreams.
      throw new CastaiApiError(
        `CastaiClient: method ${method} is not permitted by the read-only client`,
        { method, url: `${this.baseUrl}${path}` }
      );
    }

    const url = new URL(this.baseUrl + (path.startsWith('/') ? path : `/${path}`));
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, String(v));
      }
    }

    let lastError = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const signal = timeoutSignal(this.timeoutMs);
      const init = {
        method,
        headers: this._headers(),
        signal
        // No body for GET.
      };

      let res;
      try {
        res = await this.fetchImpl(url.toString(), init);
      } catch (err) {
        lastError = err;
        if (attempt === this.maxRetries) break;
        if (!this._isRetryableNetworkError(err)) {
          break;
        }
        await this._delay(attempt, err);
        continue;
      } finally {
        if (signal.__cleanup) signal.__cleanup();
      }

      if (res.ok) {
        const text = await res.text();
        let parsed = null;
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch (_) {
            parsed = text;
          }
        }
        return parsed;
      }

      lastError = new CastaiApiError(
        `CAST AI ${method} ${path} failed: ${res.status} ${res.statusText}`,
        { status: res.status, body: await this._safeText(res), url: url.toString(), method }
      );

      if (!this._isRetryableStatus(res.status) || attempt === this.maxRetries) {
        break;
      }

      await this._delay(attempt, lastError, res);
    }

    throw lastError;
  }

  _isRetryableStatus(status) {
    // 429 Too Many Requests and 5xx server errors are retryable.
    return status === 429 || (status >= 500 && status < 600);
  }

  _isRetryableNetworkError(err) {
    if (!err) return false;
    if (err.name === 'AbortError' || err.code === 'ABORT_ERR') return true;
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
      return true;
    }
    if (err.message && /timeout|abort|network/i.test(err.message)) return true;
    return false;
  }

  async _safeText(res) {
    try {
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch (_) {
        return text;
      }
    } catch (_) {
      return null;
    }
  }

  async _delay(attempt, error, res) {
    let delayMs = Math.min(1000 * 2 ** attempt, 30000);
    // Honor Retry-After for 429 responses, clamped to 60s max.
    if (res && res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      if (retryAfter) {
        const parsed = parseInt(retryAfter, 10);
        if (!Number.isNaN(parsed)) {
          delayMs = Math.min(parsed * 1000, 60000);
        }
      }
    }
    // Add small jitter to avoid thundering herd.
    delayMs += Math.floor(Math.random() * 250);
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
