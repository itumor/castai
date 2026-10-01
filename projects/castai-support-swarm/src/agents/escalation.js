// src/agents/escalation.js — section 7 of CONTRACTS.md.
// Writes caseObj.escalation — a markdown engineering package: problem,
// expected vs observed, environment, hypotheses tested w/ status, evidence
// index, repro summary, tests, customer impact, attachments list.
// Returns { escalation }.
//
// Draft-only posture: the package is markdown for a human engineer; nothing is
// sent and no state is mutated.

import { EVIDENCE_TYPES } from '../core/model.js';
import { record } from '../core/trace.js';

function orUnknown(value) {
  return value === undefined || value === null || value === '' || value === 'unknown'
    ? 'unknown'
    : String(value);
}

function firstMessageExcerpt(caseObj) {
  const messages = (caseObj.thread && caseObj.thread.messages) || [];
  const body = messages.length > 0 ? String(messages[0].body || '') : '';
  const collapsed = body.replace(/\s+/g, ' ').trim();
  return collapsed.length > 300 ? `${collapsed.slice(0, 297)}...` : collapsed || 'unknown';
}

function line(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function buildEscalationMarkdown(caseObj) {
  const triage = caseObj.triage || {};
  const entities = triage.entities || {};
  const parts = [];

  parts.push(line(`# Engineering escalation — ${caseObj.id}`));
  parts.push('\n');

  parts.push(line('## Problem'));
  parts.push(line(`- Subject: ${orUnknown(caseObj.thread && caseObj.thread.subject)}`));
  parts.push(line(`- Category: ${orUnknown(triage.category)}`));
  parts.push(line(`- Severity: ${orUnknown(triage.severity)}`));
  parts.push('\n');

  parts.push(line('## Expected vs observed'));
  parts.push(
    line(`- Expected: behavior described by the customer as expected in "${orUnknown(
      caseObj.thread && caseObj.thread.subject,
    )}".`),
  );
  parts.push(line(`- Observed: ${firstMessageExcerpt(caseObj)}`));
  parts.push('\n');

  parts.push(line('## Environment'));
  parts.push(line(`- Provider: ${orUnknown(triage.provider)}`));
  parts.push(line(`- Platform: ${orUnknown(triage.platform)}`));
  parts.push(line(`- CAST AI mode: ${orUnknown(triage.castaiMode)}`));
  parts.push(line(`- Organization id: ${orUnknown(entities.orgId)}`));
  parts.push(line(`- Cluster id: ${orUnknown(entities.clusterId)}`));
  parts.push('\n');

  parts.push(line('## Hypotheses tested'));
  if ((caseObj.hypotheses || []).length === 0) {
    parts.push(line('- (none)'));
  } else {
    for (const hypothesis of caseObj.hypotheses) {
      parts.push(line(`- ${hypothesis.id} (${hypothesis.status}): ${hypothesis.statement}`));
    }
  }
  parts.push('\n');

  parts.push(line('## Evidence index'));
  if ((caseObj.evidence || []).length === 0) {
    parts.push(line('- (none)'));
  } else {
    for (const evidence of caseObj.evidence) {
      const meta = EVIDENCE_TYPES[evidence.type];
      const cls = meta ? meta.cls : 'UNKNOWN';
      const ref = evidence.ref ? ` [ref: ${evidence.ref}]` : '';
      parts.push(
        line(`- ${evidence.id} [${evidence.type}/${cls}] (${evidence.agentId}) ${evidence.summary}${ref}`),
      );
    }
  }
  parts.push('\n');

  parts.push(line('## Reproduction summary'));
  const repro = (caseObj.evidence || []).filter((e) => e.type === 'reproduction');
  if (repro.length === 0) {
    parts.push(line('- Reproduced: no'));
  } else {
    parts.push(line('- Reproduced: yes'));
    for (const entry of repro) parts.push(line(`  - ${entry.summary}`));
  }
  parts.push('\n');

  parts.push(line('## Tests'));
  const tests = caseObj.tests || {};
  for (const level of ['unit', 'integration', 'e2e', 'regression']) {
    parts.push(line(`- ${level}: ${orUnknown(tests[level] || 'not_run')}`));
  }
  parts.push('\n');

  parts.push(line('## Customer impact'));
  parts.push(line(`- Severity: ${orUnknown(triage.severity)}`));
  parts.push(line(`- Customer statement: ${firstMessageExcerpt(caseObj)}`));
  parts.push('\n');

  parts.push(line('## Attachments'));
  const attachments = [...(caseObj.kbNotes || []), `${caseObj.id}.trace.jsonl`];
  for (const attachment of attachments) parts.push(line(`- ${attachment}`));
  parts.push('\n');

  return parts.join('');
}

/**
 * createEscalation({ llm, tools }) -> agent { id, name, async run(ctx) }.
 * Uses no tools (kb permission exists but the package is built from the case).
 */
export function createEscalation({ llm, tools } = {}) {
  return {
    id: 'escalation',
    name: 'Escalation',

    async run(ctx) {
      const caseObj = ctx.caseObj;
      record(caseObj, 'escalation', 'escalation.start', {
        category: (caseObj.triage && caseObj.triage.category) || 'unknown',
      });

      caseObj.escalation = buildEscalationMarkdown(caseObj);

      record(caseObj, 'escalation', 'escalation.package.written', {
        chars: caseObj.escalation.length,
      });

      return { escalation: caseObj.escalation };
    },
  };
}
