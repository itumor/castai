// Tests for the secure logging + redaction layer.
//
// Covers:
//   - createLogger writes redacted lines to the sink
//   - createLogger.redact handles every pattern from the spec
//   - JSON objects / nested objects have sensitive keys masked
//   - CastaiApiError scrubs its message and body
//   - tool handler errors are passed through redactErrorMessage

import { expect } from 'chai';

import { createLogger, createRedactor } from '../src/server.js';
import { CastaiApiError } from '../src/castai-client.js';
import { __internals, handlers } from '../src/tools/index.js';

// Fake CAST AI token. NOT a real credential.
const FAKE_TOKEN = 'castai_v1_AbCdEfGhIjKlMnOpQrStUvWxYz.1234567890-fake';
const FAKE_BEARER = 'eyJhbGciOi.fake.jwt_token';
const FAKE_XKEY = 'X-API-Key fakeapikey12345';

describe('createLogger', () => {
  it('writes redacted Authorization: Token headers to the sink', () => {
    const lines = [];
    const sink = { write: (s) => lines.push(s) };
    const log = createLogger('debug', sink);
    log.info(`outgoing request: Authorization: Token ${FAKE_TOKEN}`);
    const text = lines.join('');
    expect(text).to.include('[REDACTED]');
    expect(text).to.not.include(FAKE_TOKEN);
    expect(text).to.match(/Authorization: Token \[REDACTED\]/);
  });

  it('redacts Authorization: Bearer, plain Bearer and plain Token', () => {
    const lines = [];
    const sink = { write: (s) => lines.push(s) };
    const log = createLogger('debug', sink);
    log.info(`Authorization: Bearer ${FAKE_BEARER}`);
    log.info(`Bearer ${FAKE_BEARER}`);
    log.info(`Token ${FAKE_BEARER}`);
    const text = lines.join('');
    expect(text).to.not.include(FAKE_BEARER);
    expect(text).to.include('[REDACTED]');
  });

  it('redacts castai_v1_ tokens, X-API-Key and api_key= patterns', () => {
    const lines = [];
    const sink = { write: (s) => lines.push(s) };
    const log = createLogger('debug', sink);
    log.info(`creds: ${FAKE_TOKEN} and ${FAKE_XKEY} and api_key=${FAKE_TOKEN}`);
    const text = lines.join('');
    expect(text).to.not.include(FAKE_TOKEN);
    expect(text).to.match(/castai_v1_\[REDACTED\]/);
    expect(text).to.match(/X-API-Key[:\s]+\[REDACTED\]|X-api_key=\[REDACTED\]/);
    expect(text).to.match(/api_key=\[REDACTED\]/);
  });

  it('redacts JSON-stringified objects passed to the logger', () => {
    const lines = [];
    const sink = { write: (s) => lines.push(s) };
    const log = createLogger('debug', sink);
    log.info({ apiKey: FAKE_TOKEN, token: FAKE_BEARER, name: 'safe' });
    const text = lines.join('');
    expect(text).to.not.include(FAKE_TOKEN);
    expect(text).to.not.include(FAKE_BEARER);
    expect(text).to.include('"apiKey":"[REDACTED]"');
    expect(text).to.include('"token":"[REDACTED]"');
    expect(text).to.include('"name":"safe"');
  });

  it('exposes a redact hook on the returned logger', () => {
    const log = createLogger('error', { write: () => {} });
    expect(typeof log.redact).to.equal('function');
    expect(log.redact(`Token ${FAKE_TOKEN}`)).to.equal('Token [REDACTED]');
  });

  it('does not redact benign strings', () => {
    const lines = [];
    const sink = { write: (s) => lines.push(s) };
    const log = createLogger('debug', sink);
    log.info('starting castai-mcp-server on port 8080');
    const text = lines.join('');
    expect(text).to.include('starting castai-mcp-server on port 8080');
  });
});

describe('createRedactor', () => {
  const redact = createRedactor();

  it('replaces Authorization: Token <value>', () => {
    expect(redact(`Authorization: Token ${FAKE_TOKEN}`)).to.equal(
      'Authorization: Token [REDACTED]'
    );
  });

  it('replaces Authorization: Bearer <value>', () => {
    expect(redact(`Authorization: Bearer ${FAKE_BEARER}`)).to.equal(
      'Authorization: Bearer [REDACTED]'
    );
  });

  it('replaces bare Token <value> and Bearer <value>', () => {
    expect(redact(`Token ${FAKE_TOKEN}`)).to.equal('Token [REDACTED]');
    expect(redact(`Bearer ${FAKE_BEARER}`)).to.equal('Bearer [REDACTED]');
  });

  it('replaces castai_v1_<value>', () => {
    expect(redact(`key=${FAKE_TOKEN}`)).to.equal('key=castai_v1_[REDACTED]');
  });

  it('replaces X-API-Key <value>', () => {
    const out1 = redact(`X-API-Key ${FAKE_TOKEN}`);
    const out2 = redact(`X-API-Key:${FAKE_TOKEN}`);
    expect(out1).to.match(/X-API-Key[:\s]+\[REDACTED\]|X-api_key=\[REDACTED\]/);
    expect(out2).to.match(/X-API-Key[:\s]+\[REDACTED\]|X-api_key=\[REDACTED\]/);
    expect(out1).to.not.include(FAKE_TOKEN);
    expect(out2).to.not.include(FAKE_TOKEN);
  });

  it('replaces api_key / api-key / apikey patterns case-insensitively', () => {
    expect(redact(`api_key=${FAKE_TOKEN}`)).to.match(/api_key=\[REDACTED\]/);
    expect(redact(`API-Key: ${FAKE_TOKEN}`)).to.match(/api_key=\[REDACTED\]/i);
    expect(redact(`apikey=${FAKE_TOKEN}`)).to.match(/api_key=\[REDACTED\]/i);
  });

  it('masks JSON string values for sensitive keys', () => {
    const payload = JSON.stringify({
      apiKey: FAKE_TOKEN,
      api_key: FAKE_TOKEN,
      token: FAKE_BEARER,
      accessToken: FAKE_BEARER,
      authToken: FAKE_TOKEN,
      password: 'hunter2',
      secret: 'shh',
      clientSecret: 'cs',
      name: 'safe'
    });
    const out = redact(payload);
    expect(out).to.not.include(FAKE_TOKEN);
    expect(out).to.not.include(FAKE_BEARER);
    expect(out).to.not.include('hunter2');
    expect(out).to.not.include('shh');
    expect(out).to.not.include('"cs"');
    expect(out).to.include('"name":"safe"');
    expect(out).to.match(/"apiKey":"\[REDACTED\]"/);
    expect(out).to.match(/"password":"\[REDACTED\]"/);
  });

  it('masks nested JSON secrets', () => {
    const payload = JSON.stringify({
      outer: {
        inner: { token: FAKE_TOKEN, keep: 'yes' },
        list: [{ secret: 'one' }, { secret: 'two', other: 'ok' }]
      }
    });
    const out = redact(payload);
    expect(out).to.not.include(FAKE_TOKEN);
    expect(out).to.not.include('"one"');
    expect(out).to.not.include('"two"');
    expect(out).to.include('"keep":"yes"');
    expect(out).to.include('"other":"ok"');
  });

  it('leaves non-secret strings unchanged', () => {
    const s = 'just a normal log line with 42 numbers and !punct.';
    expect(redact(s)).to.equal(s);
  });
});

describe('CastaiApiError', () => {
  it('redacts its own message', () => {
    const err = new CastaiApiError(`failed: Token ${FAKE_TOKEN}`, { status: 401 });
    expect(err.message).to.not.include(FAKE_TOKEN);
    expect(err.message).to.include('[REDACTED]');
    expect(err.name).to.equal('CastaiApiError');
    expect(err.status).to.equal(401);
  });

  it('redacts sensitive fields inside the body', () => {
    const err = new CastaiApiError('boom', {
      status: 500,
      body: { apiKey: FAKE_TOKEN, token: FAKE_BEARER, ok: true }
    });
    expect(JSON.stringify(err.body)).to.not.include(FAKE_TOKEN);
    expect(JSON.stringify(err.body)).to.not.include(FAKE_BEARER);
    expect(err.body.ok).to.equal(true);
  });
});

describe('tool handler error path', () => {
  it('redacts secrets surfaced through formatError', () => {
    const sentinelErr = new CastaiApiError(
      `CAST AI GET /v1/x failed: 401 — Token ${FAKE_TOKEN}`
    );
    const out = __internals.formatError(sentinelErr);
    expect(out.isError).to.equal(true);
    expect(out.content[0].text).to.not.include(FAKE_TOKEN);
    expect(out.content[0].text).to.include('[REDACTED]');
    expect(out.content[0].text).to.include('401');
  });

  it('handler returns redacted text when the client throws', async () => {
    const sentinelErr = new CastaiApiError(`failed with Token ${FAKE_TOKEN}`);
    const stubGet = async () => {
      throw sentinelErr;
    };
    const res = await handlers.list_clusters({}, { client: { get: stubGet } });
    expect(res.isError).to.equal(true);
    expect(res.content[0].text).to.not.include(FAKE_TOKEN);
    expect(res.content[0].text).to.include('[REDACTED]');
  });

  it('redactErrorMessage is idempotent', () => {
    const once = __internals.redactErrorMessage(`Token ${FAKE_TOKEN}`);
    const twice = __internals.redactErrorMessage(once);
    expect(twice).to.equal(once);
  });
});
