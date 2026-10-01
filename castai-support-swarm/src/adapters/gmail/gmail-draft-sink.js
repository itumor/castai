import { redact } from '../../core/redact.js';

// The ONLY Gmail endpoint string in this module. Draft creation only —
// there is no way to dispatch a message from here: the drafts collection
// is the sole target and no message-transmission method exists anywhere
// in this file.
const GMAIL_DRAFTS_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts';

/**
 * Gmail-backed DraftSink: creates a Gmail draft via the Gmail API.
 *
 * HARD SAFETY PROPERTY: this adapter can only CREATE DRAFTS. It contains
 * exactly one Gmail endpoint string (the drafts collection above) and no
 * message-transmission capability of any kind — a draft lands in the
 * user's Gmail drafts folder and is never dispatched. The draft body is
 * passed through `redact()` BEFORE it is encoded and transmitted.
 *
 * @implements {import('./draft-sink.js').DraftSink}
 */
export class GmailDraftSink {
  /**
   * @param {{accessToken?: string, fetchImpl?: typeof fetch}} options
   *        accessToken falls back to the GMAIL_OAUTH_TOKEN env var (opt-in).
   *        Missing in both places → throws at construction.
   */
  constructor({ accessToken, fetchImpl } = {}) {
    const token = accessToken || process.env.GMAIL_OAUTH_TOKEN;
    if (!token) {
      throw new Error(
        'GmailDraftSink requires an OAuth token: pass accessToken or set GMAIL_OAUTH_TOKEN'
      );
    }
    this.accessToken = token;
    this.fetchImpl = fetchImpl || globalThis.fetch;
  }

  /**
   * @param {import('../../core/types.js').DraftPost & {to?: string, subject?: string}} draftPost
   * @returns {Promise<{draftId: string}>} id of the created Gmail draft
   */
  async save(draftPost) {
    const to = draftPost?.to ?? '';
    const subject = draftPost?.subject ?? '';
    // Redact FIRST: the secret never reaches the MIME message.
    const body = redact(draftPost?.body ?? '');

    // Minimal RFC 822 message: headers, blank line, redacted body.
    const mime = `To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`;
    const raw = Buffer.from(mime, 'utf8').toString('base64url');

    const response = await this.fetchImpl(GMAIL_DRAFTS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: { raw } })
    });

    if (!response.ok) {
      const detail = redact(await response.text());
      throw new Error(`GmailDraftSink draft creation failed (${response.status}): ${detail}`);
    }

    const data = await response.json();
    return { draftId: data.id };
  }
}
