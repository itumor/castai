import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GmailDraftSink } from '../../src/adapters/gmail/gmail-draft-sink.js';

const MODULE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/adapters/gmail/gmail-draft-sink.js'
);
const ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts';

/** Fetch stub that records every call and replies with a scripted response. */
function stubFetch(response) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  impl.calls = calls;
  return impl;
}

test('save() POSTs a redacted RFC822 draft to the drafts endpoint and returns draftId', async () => {
  const fetchImpl = stubFetch({
    ok: true,
    status: 200,
    json: async () => ({ id: 'draft-abc123', message: { id: 'msg-1', threadId: 't-1' } })
  });
  const sink = new GmailDraftSink({ accessToken: 'test-token-abc', fetchImpl });

  const result = await sink.save({
    caseId: 'case-1',
    to: 'customer@example.com',
    subject: 'Re: your support case',
    body: 'Hello,\n\nPlease run kubectl get nodes.\nSecond line.'
  });

  assert.equal(result.draftId, 'draft-abc123');
  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];

  // Endpoint + method
  assert.equal(url, ENDPOINT);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer test-token-abc');
  assert.equal(init.headers['Content-Type'], 'application/json');

  // Body shape: { message: { raw: base64url(mime) } }
  const payload = JSON.parse(init.body);
  assert.ok(payload.message && typeof payload.message.raw === 'string');
  const decoded = Buffer.from(payload.message.raw, 'base64url').toString('utf8');

  // Minimal RFC822: To header, Subject header, blank line, body
  assert.ok(decoded.startsWith('To: customer@example.com\r\n'), `decoded=${JSON.stringify(decoded)}`);
  assert.ok(decoded.includes('Subject: Re: your support case'), `decoded=${JSON.stringify(decoded)}`);
  assert.ok(decoded.includes('\r\n\r\n'), 'expected blank line between headers and body');
  assert.ok(decoded.endsWith('Hello,\n\nPlease run kubectl get nodes.\nSecond line.'));
});

test('source-grep: module has no messages/send string, no .send call, and exactly one endpoint string', async () => {
  const source = await readFile(MODULE_PATH, 'utf8');

  assert.ok(!source.includes('messages/send'), 'module must not contain the messages/send path');
  assert.ok(!/\.send\s*\(/.test(source), 'module must not contain a .send( method call');
  assert.ok(!/(^|[^.\w])send\s*\(/.test(source), 'module must not contain a send( identifier');

  // Exactly ONE Gmail endpoint string in the module.
  const occurrences = source.split(ENDPOINT).length - 1;
  assert.equal(occurrences, 1, 'module must contain the drafts endpoint exactly once');
});

test('redaction: planted CAST AI token in body is masked before encoding', async () => {
  const fetchImpl = stubFetch({
    ok: true,
    status: 200,
    json: async () => ({ id: 'draft-redact' })
  });
  const sink = new GmailDraftSink({ accessToken: 'test-token-abc', fetchImpl });

  await sink.save({
    caseId: 'case-2',
    to: 'customer@example.com',
    subject: 'Re: credentials',
    body: 'Here is my key: castai_v1_secret123 please help'
  });

  const { init } = fetchImpl.calls[0];
  const payload = JSON.parse(init.body);
  const decoded = Buffer.from(payload.message.raw, 'base64url').toString('utf8');

  assert.ok(!decoded.includes('castai_v1_secret123'), 'secret must not appear in the raw message');
  assert.ok(decoded.includes('castai_v1_[REDACTED]'), 'masked placeholder must appear instead');
});

test('constructor throws when no token is provided (arg or GMAIL_OAUTH_TOKEN env)', () => {
  const prev = process.env.GMAIL_OAUTH_TOKEN;
  delete process.env.GMAIL_OAUTH_TOKEN;
  try {
    assert.throws(() => new GmailDraftSink({}), /GMAIL_OAUTH_TOKEN/);
    assert.throws(() => new GmailDraftSink(), /GMAIL_OAUTH_TOKEN/);
    assert.throws(() => new GmailDraftSink({ accessToken: '' }), /GMAIL_OAUTH_TOKEN/);
  } finally {
    if (prev !== undefined) process.env.GMAIL_OAUTH_TOKEN = prev;
  }
});

test('non-2xx response throws with a redacted error message', async () => {
  const fetchImpl = stubFetch({
    ok: false,
    status: 500,
    text: async () => 'upstream error: castai_v1_topsecret99 leaked in body'
  });
  const sink = new GmailDraftSink({ accessToken: 'test-token-abc', fetchImpl });

  await assert.rejects(
    sink.save({ caseId: 'case-3', to: 'a@b.com', subject: 's', body: 'b' }),
    (err) => {
      assert.match(err.message, /500/);
      assert.match(err.message, /\[REDACTED\]/);
      assert.ok(!err.message.includes('castai_v1_topsecret99'), 'secret must not leak into error');
      return true;
    }
  );
});
