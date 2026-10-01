import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GmailDraftSink } from '../../src/adapters/gmail/gmail-draft-sink.js';

// Chunk 17c — Integration test: Gmail draft (opt-in, drafts-only, never send).
//
// Opt-in run:    SWARM_INT_GMAIL=1 GMAIL_OAUTH_TOKEN=<token> node --test test/integration/int-gmail-draft.test.js
// Default (CI):  no env vars → the live-network test skips cleanly, the
//                always-run stubbed test still executes.

test('GmailDraftSink creates a real draft in the test account (opt-in via env)', { timeout: 30_000 }, async (t) => {
  // Guard FIRST — skip (never fail) when the integration is not opted in.
  const missing = [];
  if (process.env.SWARM_INT_GMAIL !== '1') missing.push('SWARM_INT_GMAIL');
  if (!process.env.GMAIL_OAUTH_TOKEN) missing.push('GMAIL_OAUTH_TOKEN');
  if (missing.length > 0) {
    t.skip(`set SWARM_INT_GMAIL=1 + GMAIL_OAUTH_TOKEN to enable; missing: ${missing.join(', ')}`);
    return;
  }

  // Real sink on native fetch: no fetchImpl override, token from env.
  const sink = new GmailDraftSink({ accessToken: process.env.GMAIL_OAUTH_TOKEN });

  const stamp = new Date().toISOString();
  const subject = `swarm-integration-test ${stamp}`;
  const body =
    'This is an automated test draft created by the castai-support-swarm ' +
    `integration suite at ${stamp}. It is a draft only — no email was sent. ` +
    'Safe to delete.';

  const { draftId } = await sink.save({ to: '', subject, body });

  assert.equal(typeof draftId, 'string', 'draftId must be a string');
  assert.ok(draftId.length > 0, 'draftId must be non-empty');

  // Log the draft id only — never the OAuth token.
  console.log(`created Gmail draft id: ${draftId}`);
});

test('GmailDraftSink requests hit the drafts endpoint and never a send endpoint', async () => {
  // Always-run (no env needed): stubbed fetch captures the outgoing request.
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'draft-stub-123' })
    };
  };

  const sink = new GmailDraftSink({ accessToken: 'stub-token-never-used-on-network', fetchImpl });
  const { draftId } = await sink.save({ to: '', subject: 'swarm-integration-test stub', body: 'stub body' });

  assert.equal(calls.length, 1, 'exactly one HTTP call expected');
  const { url, init } = calls[0];
  assert.ok(url.includes('/drafts'), `request URL must contain /drafts, got: ${url}`);
  assert.ok(!url.includes('/send'), `request URL must NOT contain /send, got: ${url}`);
  assert.equal(init.method, 'POST');

  assert.equal(draftId, 'draft-stub-123');
});
