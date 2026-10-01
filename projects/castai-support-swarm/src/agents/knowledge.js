// src/agents/knowledge.js — section 7 of CONTRACTS.md.
// Writes a KB note `kb/<date>-<caseId>.md` (inside this package) capturing the
// generic problem, detection signals, resolution, and a reusable checklist.
// Appends the path to caseObj.kbNotes. Returns { notePath }.
//
// The kb directory is created with mkdir recursive. The filename follows the
// contract exactly; if a same-named note already exists (repeat run of the
// same case), a `-N` suffix makes the new name unique — notes are never
// overwritten. Tests can redirect the root via ctx.params.kbRoot so nothing
// is written outside os.tmpdir().

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertToolAllowed } from '../core/policy.js';
import { record } from '../core/trace.js';

/** <packageRoot>/kb — two levels up from src/agents/knowledge.js. */
function defaultKbRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'kb');
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const HEX_ID_PATTERN = /\b[0-9a-fA-F][0-9a-fA-F-]{7,}\b/g;

/** Tokens that identify THIS case's customer (first names, surnames). */
function customerNameTokens(caseObj) {
  const names = [
    caseObj.customer && caseObj.customer.name,
    caseObj.triage && caseObj.triage.customerName,
  ];
  const tokens = new Set();
  for (const name of names) {
    for (const part of String(name || '').split(/\s+/)) {
      const clean = part.replace(/[^A-Za-z'’]/g, '');
      if (clean.length >= 3) tokens.add(clean);
    }
  }
  return [...tokens].sort((a, b) => b.length - a.length); // longest first
}

/**
 * Notes are re-ingested as prior_ticket evidence, so they carry no customer
 * identifiers: emails, org/cluster-shaped hex ids and the case customer's
 * name tokens are neutralized ('<email>', '<id>', '<customer>').
 */
function maskForNote(text, nameTokens) {
  let out = String(text || '');
  out = out.replace(EMAIL_PATTERN, '<email>');
  out = out.replace(HEX_ID_PATTERN, '<id>');
  for (const token of nameTokens) {
    out = out.replace(new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '<customer>');
  }
  return out;
}

function noteFor(caseObj, date) {
  const triage = caseObj.triage || {};
  const nameTokens = customerNameTokens(caseObj);
  const mask = (text) => maskForNote(text, nameTokens);
  const category = triage.category || 'unknown';
  const subject = mask((caseObj.thread && caseObj.thread.subject) || 'undescribed issue');
  const lines = [];

  lines.push(`# ${category}: support case ${caseObj.id}`);
  lines.push('');
  lines.push(`- Date: ${date}`);
  lines.push(`- Case: ${caseObj.id}`);
  lines.push(`- Category: ${category}`);
  lines.push(`- Topic: ${subject}`);
  lines.push('');

  lines.push('## Problem');
  lines.push(
    `A customer hit a ${category} case: "${subject}". This note captures the generic ` +
      'shape of the problem so the next occurrence is handled faster; all customer-specific ' +
      'identifiers stay in the case ledger, not here.',
  );
  lines.push('');

  lines.push('## Detection signals');
  const signals = (caseObj.evidence || []).map((e) => `- [${e.type}] ${mask(e.summary)}`);
  const questions = (triage.questions || []).map((q) => `- customer question: ${mask(q)}`);
  for (const signal of [...signals, ...questions]) lines.push(signal);
  if (signals.length === 0 && questions.length === 0) lines.push('- (none recorded)');
  lines.push('');

  lines.push('## Resolution');
  const steps = (caseObj.solution && caseObj.solution.steps) || [];
  if (steps.length === 0) {
    lines.push('- (no resolution recorded)');
  } else {
    steps.forEach((step, index) => lines.push(`${index + 1}. ${mask(step)}`));
  }
  lines.push('');

  lines.push('## Reusable checklist');
  lines.push('- [ ] Confirm the organization id and cluster id before investigating.');
  lines.push('- [ ] Reproduce the behavior in the lab before claiming a fix (read-only).');
  lines.push('- [ ] Attach evidence to every claim; let the verifier gate the answer.');
  if (category === 'node_downscale') {
    lines.push('- [ ] Check eviction blockers first: PDBs, local storage, do-not-evict annotations, unmanaged pods.');
  } else if (category === 'iam_onboarding') {
    lines.push('- [ ] Scope iam:PutRolePolicy to the specific CAST AI role ARNs; never widen to IAMFullAccess.');
  } else if (category === 'token_rotation') {
    lines.push('- [ ] Update every secret using the cluster token and restart every component.');
  } else {
    lines.push('- [ ] Search kb notes for prior occurrences of this category.');
  }
  lines.push('- [ ] Draft the reply with grounded claims only; a human reviews before any send.');
  lines.push('');

  return lines.join('\n');
}

/**
 * createKnowledge({ llm, tools }) -> agent { id, name, async run(ctx) }.
 * Writes via the kbWrite permission only (asserted before the write).
 */
export function createKnowledge({ llm, tools } = {}) {
  return {
    id: 'knowledge',
    name: 'Knowledge',

    async run(ctx) {
      const caseObj = ctx.caseObj;
      const params = ctx.params || {};
      record(caseObj, 'knowledge', 'knowledge.start', {});

      // Writing KB notes is allowed for this agent via the kbWrite permission.
      assertToolAllowed('knowledge', 'kbWrite');

      const kbRoot = params.kbRoot || defaultKbRoot();
      await mkdir(kbRoot, { recursive: true });

      const date = new Date().toISOString().slice(0, 10);
      let notePath = join(kbRoot, `${date}-${caseObj.id}.md`);
      let suffix = 2;
      while (existsSync(notePath)) {
        notePath = join(kbRoot, `${date}-${caseObj.id}-${suffix}.md`);
        suffix += 1;
      }

      const note = noteFor(caseObj, date);
      assert.ok(note.length > 0, 'kb note must not be empty');
      await writeFile(notePath, note, 'utf8');

      caseObj.kbNotes.push(notePath);
      record(caseObj, 'knowledge', 'knowledge.note.written', { notePath });

      return { notePath };
    },
  };
}
