// Tests for the CAST AI HTTP client wrapper.
// These run under mocha + chai after `npm install`. They only exercise
// pure-JS behaviour of CastaiClient and stub fetch via a fetchImpl.

import { expect } from 'chai';
import { CastaiClient, CastaiApiError } from '../src/castai-client.js';

function makeFetchStub(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) {
      throw new Error(`unexpected fetch call to ${url}`);
    }
    return next;
  };
  return { fn, calls };
}

function jsonResponse(status, body, statusText, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: statusText || (status >= 200 && status < 300 ? 'OK' : 'Error'),
    headers: {
      get: (key) => headers[key] || null
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  };
}

function networkError(message, code) {
  const err = new Error(message);
  err.name = 'TypeError';
  err.code = code;
  return err;
}

function stubDelay(client) {
  // Eliminate real sleeps in retry tests so they remain fast and deterministic.
  client._delay = () => Promise.resolve();
}

describe('CastaiClient', () => {
  it('throws when constructed without an apiKey', () => {
    expect(() => new CastaiClient({ apiKey: '' })).to.throw(/apiKey is required/);
  });

  it('defaults baseUrl to the EU API', () => {
    const { fn } = makeFetchStub([jsonResponse(200, {})]);
    const c = new CastaiClient({ apiKey: 'k', fetchImpl: fn });
    expect(c.baseUrl).to.equal('https://api.eu.cast.ai');
  });

  it('strips trailing slash from a custom baseUrl', () => {
    const { fn } = makeFetchStub([jsonResponse(200, {})]);
    const c = new CastaiClient({
      apiKey: 'k',
      baseUrl: 'https://api.eu.cast.ai/',
      fetchImpl: fn
    });
    expect(c.baseUrl).to.equal('https://api.eu.cast.ai');
  });

  it('sends Authorization: Token <key> and optional X-Organization-Id', async () => {
    const { fn, calls } = makeFetchStub([
      jsonResponse(200, { items: [] })
    ]);
    const c = new CastaiClient({
      apiKey: 'k',
      orgId: 'org-uuid',
      fetchImpl: fn
    });
    await c.get('/v1/kubernetes/external-clusters');

    expect(calls).to.have.lengthOf(1);
    const headers = calls[0].init.headers;
    expect(headers.Authorization).to.equal('Token k');
    expect(headers['X-Organization-Id']).to.equal('org-uuid');
    expect(headers.Accept).to.equal('application/json');
  });

  it('omits X-Organization-Id when no org is bound', async () => {
    const { fn, calls } = makeFetchStub([jsonResponse(200, {})]);
    const c = new CastaiClient({ apiKey: 'k', fetchImpl: fn });
    await c.get('/v1/something');
    expect(calls[0].init.headers).to.not.have.property('X-Organization-Id');
  });

  it('returns parsed JSON on 2xx', async () => {
    const { fn } = makeFetchStub([
      jsonResponse(200, { hello: 'world' })
    ]);
    const c = new CastaiClient({ apiKey: 'k', fetchImpl: fn });
    const res = await c.get('/v1/anything');
    expect(res).to.deep.equal({ hello: 'world' });
  });

  it('throws CastaiApiError on non-2xx with status and body', async () => {
    const { fn } = makeFetchStub([
      jsonResponse(401, { message: 'unauthorized' }, 'Unauthorized')
    ]);
    const c = new CastaiClient({ apiKey: 'bad', fetchImpl: fn });
    let caught = null;
    try {
      await c.get('/v1/anything');
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(CastaiApiError);
    expect(caught.status).to.equal(401);
    expect(caught.body).to.deep.equal({ message: 'unauthorized' });
    expect(caught.url).to.match(/^https:\/\/api\.eu\.cast\.ai\/v1\/anything/);
  });

  it('appends query parameters to the request URL', async () => {
    const { fn, calls } = makeFetchStub([jsonResponse(200, {})]);
    const c = new CastaiClient({ apiKey: 'k', fetchImpl: fn });
    await c.get('/v1/things', { query: { limit: 5, offset: 0 } });
    const u = new URL(calls[0].url);
    expect(u.searchParams.get('limit')).to.equal('5');
    expect(u.searchParams.get('offset')).to.equal('0');
  });

  it('skips null/undefined query values', async () => {
    const { fn, calls } = makeFetchStub([jsonResponse(200, {})]);
    const c = new CastaiClient({ apiKey: 'k', fetchImpl: fn });
    await c.get('/v1/things', { query: { limit: 5, cursor: null, prev: undefined } });
    const u = new URL(calls[0].url);
    expect(u.searchParams.get('limit')).to.equal('5');
    expect(u.searchParams.has('cursor')).to.equal(false);
    expect(u.searchParams.has('prev')).to.equal(false);
  });

  it('retries on 429 and honors Retry-After', async () => {
    const { fn, calls } = makeFetchStub([
      jsonResponse(429, { error: 'rate limited' }, 'Too Many Requests', { 'Retry-After': '1' }),
      jsonResponse(200, { ok: true })
    ]);
    const c = new CastaiClient({ apiKey: 'k', fetchImpl: fn, maxRetries: 3 });
    stubDelay(c);
    const res = await c.get('/v1/things');
    expect(calls).to.have.lengthOf(2);
    expect(res).to.deep.equal({ ok: true });
  });

  it('retries on 5xx responses and succeeds when upstream recovers', async () => {
    const { fn, calls } = makeFetchStub([
      jsonResponse(502, { error: 'bad gateway' }, 'Bad Gateway'),
      jsonResponse(503, { error: 'unavailable' }, 'Service Unavailable'),
      jsonResponse(200, { recovered: true })
    ]);
    const c = new CastaiClient({ apiKey: 'k', fetchImpl: fn, maxRetries: 3 });
    stubDelay(c);
    const res = await c.get('/v1/things');
    expect(calls).to.have.lengthOf(3);
    expect(res).to.deep.equal({ recovered: true });
  });

  it('does not retry non-retryable 4xx errors', async () => {
    const { fn, calls } = makeFetchStub([
      jsonResponse(404, { error: 'not found' }, 'Not Found')
    ]);
    const c = new CastaiClient({ apiKey: 'k', fetchImpl: fn, maxRetries: 3 });
    let caught = null;
    try {
      await c.get('/v1/things');
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(CastaiApiError);
    expect(caught.status).to.equal(404);
    expect(calls).to.have.lengthOf(1);
  });

  it('retries transient network errors', async () => {
    let calls = 0;
    const fn = async (url, init) => {
      calls += 1;
      if (calls === 1) {
        throw networkError('fetch failed', 'ECONNRESET');
      }
      return jsonResponse(200, { ok: true });
    };
    const c = new CastaiClient({ apiKey: 'k', fetchImpl: fn, maxRetries: 3 });
    stubDelay(c);
    const res = await c.get('/v1/things');
    expect(calls).to.equal(2);
    expect(res).to.deep.equal({ ok: true });
  });

  it('gives up after exhausting maxRetries', async () => {
    const { fn, calls } = makeFetchStub([
      jsonResponse(504, { error: 'timeout' }, 'Gateway Timeout'),
      jsonResponse(504, { error: 'timeout' }, 'Gateway Timeout'),
      jsonResponse(504, { error: 'timeout' }, 'Gateway Timeout'),
      jsonResponse(504, { error: 'timeout' }, 'Gateway Timeout')
    ]);
    const c = new CastaiClient({ apiKey: 'k', fetchImpl: fn, maxRetries: 3 });
    stubDelay(c);
    let caught = null;
    try {
      await c.get('/v1/things');
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(CastaiApiError);
    expect(caught.status).to.equal(504);
    expect(calls).to.have.lengthOf(4);
  });

  it('aborts requests that exceed timeoutMs', async () => {
    const responses = [];
    const fn = async (url, init) => {
      responses.push({ url, init });
      return new Promise((_resolve, reject) => {
        const onAbort = () => reject(new Error('AbortError'));
        if (init.signal && init.signal.aborted) {
          onAbort();
          return;
        }
        if (init.signal) {
          init.signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    };
    const c = new CastaiClient({ apiKey: 'k', fetchImpl: fn, timeoutMs: 50, maxRetries: 0 });
    let caught = null;
    try {
      await c.get('/v1/things');
    } catch (err) {
      caught = err;
    }
    expect(caught).to.not.equal(null);
    expect(caught.name === 'AbortError' || /AbortError|timeout/i.test(caught.message)).to.equal(true);
  });
});
