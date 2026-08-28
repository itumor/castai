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

function jsonResponse(status, body, statusText) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: statusText || (status >= 200 && status < 300 ? 'OK' : 'Error'),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  };
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
});
