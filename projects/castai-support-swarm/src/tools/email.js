// src/tools/email.js — draft-only email outbox (contract section 6).
//
// Safety (root AGENTS.md): this tool NEVER sends anything. It only writes
// draft files for a human to review and send. caseId is validated so drafts
// can never escape the outbox directory.

import { promises as fsp } from 'node:fs';
import path from 'node:path';

/** assertSafeCaseId — caseId becomes a file name; separators/traversal are rejected. */
function assertSafeCaseId(caseId) {
  if (
    typeof caseId !== 'string' ||
    caseId.length === 0 ||
    caseId.includes('/') ||
    caseId.includes('\\') ||
    caseId.includes('..')
  ) {
    throw new Error(`draftEmail: unsafe caseId: ${caseId}`);
  }
}

/**
 * draftEmail({ outboxDir, caseId, to, subject, body, meta = {} })
 * mkdir -p outboxDir; writes <outboxDir>/<caseId>.md (body) and
 * <outboxDir>/<caseId>.json ({ to, subject, caseId, draftOnly: true,
 * createdAt, ...meta }); returns { mdPath, jsonPath }.
 */
export async function draftEmail({ outboxDir, caseId, to, subject, body, meta = {} } = {}) {
  if (typeof outboxDir !== 'string' || outboxDir.length === 0) {
    throw new Error('draftEmail: outboxDir is required');
  }
  assertSafeCaseId(caseId);

  await fsp.mkdir(outboxDir, { recursive: true });

  const mdPath = path.join(outboxDir, `${caseId}.md`);
  const jsonPath = path.join(outboxDir, `${caseId}.json`);
  const payload = {
    to,
    subject,
    caseId,
    draftOnly: true,
    createdAt: new Date().toISOString(),
    ...meta,
  };

  await fsp.writeFile(mdPath, body ?? '', 'utf8');
  await fsp.writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  return { mdPath, jsonPath };
}
