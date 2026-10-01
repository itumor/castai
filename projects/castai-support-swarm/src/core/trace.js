// src/core/trace.js — section 5 of CONTRACTS.md
// Append-only case trace. Every entry is redacted before it lands: key-based
// redaction plus secret-shaped string masking (policy.js), so the audit trail
// does not persist a value shaped like a known secret.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { redact } from './policy.js';

/**
 * record(caseObj, actor, action, detail = {})
 * Pushes { at, actor, action, detail } onto caseObj.trace; detail is run
 * through redact() from policy.js first.
 */
export function record(caseObj, actor, action, detail = {}) {
  if (!Array.isArray(caseObj.trace)) caseObj.trace = [];
  const entry = {
    at: new Date().toISOString(),
    actor,
    action,
    detail: redact(detail),
  };
  caseObj.trace.push(entry);
  return entry;
}

/** assertSafeCaseId — identical rule to tools/email.js: the id becomes a file name. */
function assertSafeCaseId(id) {
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('..')
  ) {
    throw new Error(`persistTrace: unsafe case id: ${id}`);
  }
}

/**
 * persistTrace(caseObj, dir) -> path
 * mkdir -p <dir>, then writes <dir>/<caseObj.id>.trace.jsonl —
 * one JSON object per line. The case id is validated exactly like the email
 * tool validates caseId, so a trace can never escape the traces directory.
 */
export async function persistTrace(caseObj, dir) {
  assertSafeCaseId(caseObj && caseObj.id);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${caseObj.id}.trace.jsonl`);
  const lines = (caseObj.trace || []).map((entry) => JSON.stringify(entry));
  await writeFile(filePath, lines.join('\n') + (lines.length > 0 ? '\n' : ''), 'utf8');
  return filePath;
}
