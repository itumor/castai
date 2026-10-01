/**
 * DraftSink adapter interface (where finished drafts are delivered).
 *
 * @interface DraftSink
 * @description Exactly one async method:
 *
 *   save(draftPost) → Promise<{ path?: string, draftId?: string }>
 *
 *   - `draftPost` is a validated DraftPost ({ to, subject, body, caseId,
 *     confidence, route, unresolvedClaims }); implementations may carry
 *     optional extras such as `draftPost.ledger` / `draftPost.verdict`.
 *   - Resolves with a locator for the saved draft: `path` for file-backed
 *     sinks, `draftId` for API-backed sinks. Rejects on failure.
 *
 * Implementations:
 *   - src/adapters/gmail/file-draft-sink.js  (writes out/<caseId>/draft.md)
 *   - src/adapters/gmail/gmail-draft-sink.js (real Gmail drafts API, drafts only)
 */
