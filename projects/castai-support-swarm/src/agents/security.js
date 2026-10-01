// src/agents/security.js — section 7 of CONTRACTS.md.
// For iam_* categories: reasons about least privilege. EVIDENCE HONESTY
// (binding): every documentation/prior_ticket evidence entry quotes a real
// source the agent actually read through its `kb` tool permission (repo-
// relative ref from an on-disk hit) — invented refs are fabrication and
// forbidden. The least-privilege reasoning itself is recorded as ONE
// `inference` evidence entry (INFERRED, 0 points, no ref — it can never
// satisfy the verifier's DOCUMENTED/hard-proof requirements) and appended as
// 'Risk: ...' notes into the solution steps. Returns { evidenceAdded, risks }.
//
// For any other category the agent records a skip and returns empty results —
// it only activates meaningfully for iam_onboarding.
//
// Core IAM reasoning: `iam:PutRolePolicy` is a WRITE action. The customer's CI
// role needs it scoped to the specific CAST AI role ARNs, applied through the
// reviewed Terraform/CI path — never IAMFullAccess, never a live console
// change (root AGENTS.md read-only posture).

import { addClaim, addEvidence, linkEvidenceToClaim } from '../core/model.js';
import { assertToolAllowed } from '../core/policy.js';
import { record } from '../core/trace.js';
import { classifyKbHit, toLedgerRef } from './researcher.js';

// Deterministic queries the security agent issues against the real knowledge
// base (its only permitted tool). Whatever they return is the ONLY grounding
// this agent may cite.
const IAM_KB_QUERIES = [
  'iam:PutRolePolicy onboarding AccessDenied',
  'least privilege CI role policy scope',
];
const IAM_KB_LIMIT = 2;

const LEAST_PRIVILEGE_REASONING =
  'Least-privilege reasoning (security agent, inference — not a source): ' +
  'iam:PutRolePolicy is a write action. The CI identity needs it scoped to the ' +
  'specific CAST AI role ARNs through the reviewed Terraform/CI path; widening ' +
  'to Resource "*" would let it rewrite any role in the account, and ' +
  'IAMFullAccess is never an acceptable substitute.';

function isIamCategory(caseObj) {
  const category = caseObj.triage && caseObj.triage.category;
  return typeof category === 'string' && category.startsWith('iam');
}

function buildRisks() {
  return [
    'Risk: iam:PutRolePolicy is a write action — apply it only through the reviewed Terraform/CI path, never as a live console change on the customer account.',
    'Risk: scope iam:PutRolePolicy to the specific CAST AI role ARNs only; never widen the CI role policy to Resource "*" or it can rewrite any role in the account.',
    'Risk: never substitute IAMFullAccess or iam:* for this fix — least privilege means the CI role gets exactly PutRolePolicy on the CAST AI roles it must bootstrap.',
  ];
}

function oneLine(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * createSecurity({ llm, tools }) -> agent { id, name, async run(ctx) }.
 * Only tool: kb (asserted before use). Read-only. Adds evidence plus ONE
 * least-privilege conclusion claim linked exclusively to that evidence.
 */
export function createSecurity({ llm, tools } = {}) {
  return {
    id: 'security',
    name: 'Security',

    async run(ctx) {
      const caseObj = ctx.caseObj;
      const params = ctx.params || {};
      const category = (caseObj.triage && caseObj.triage.category) || 'unknown';

      if (!isIamCategory(caseObj)) {
        record(caseObj, 'security', 'security.skipped', { category });
        return { evidenceAdded: 0, risks: [] };
      }

      record(caseObj, 'security', 'security.start', { category });

      let evidenceAdded = 0;
      const evidenceIds = [];

      // 1. Real KB grounding. The agent reads the knowledge base through its
      //    permitted tool and cites exactly what came back (deduped by ref).
      const kbTool = tools && tools.kb && typeof tools.kb.searchKb === 'function' ? tools.kb : null;
      if (kbTool) {
        assertToolAllowed('security', 'kb');
        const roots = Array.isArray(params.kbRoots) ? params.kbRoots : undefined;
        for (const query of IAM_KB_QUERIES) {
          let hits = [];
          try {
            hits = await kbTool.searchKb({
              repoRoot: ctx.repoRoot,
              query,
              limit: IAM_KB_LIMIT,
              ...(roots ? { roots } : {}),
            });
          } catch {
            hits = [];
          }
          record(caseObj, 'security', 'security.kb.search', {
            query,
            hits: Array.isArray(hits) ? hits.length : 0,
          });
          for (const hit of Array.isArray(hits) ? hits : []) {
            if (!hit || typeof hit.path !== 'string' || hit.path.length === 0) continue;
            const ref = toLedgerRef(hit.path, ctx.repoRoot);
            let entry = (caseObj.evidence || []).find((e) => e.ref === ref);
            if (!entry) {
              entry = addEvidence(caseObj, {
                type: classifyKbHit(ref),
                source: 'kb',
                ref,
                summary: oneLine(hit.snippet),
                agentId: 'security',
              });
              evidenceAdded += 1;
              record(caseObj, 'security', 'security.evidence.added', {
                evidenceIds: [entry.id],
                type: entry.type,
                ref,
              });
            }
            if (!evidenceIds.includes(entry.id)) evidenceIds.push(entry.id);
          }
        }
      } else {
        record(caseObj, 'security', 'kb.unavailable', { queries: IAM_KB_QUERIES.length });
      }

      // 2. The agent's own reasoning — honest INFERENCE provenance (0 points).
      const reasoning = addEvidence(caseObj, {
        type: 'inference',
        source: 'security-reasoning',
        summary: LEAST_PRIVILEGE_REASONING,
        agentId: 'security',
      });
      evidenceAdded += 1;
      evidenceIds.push(reasoning.id);
      record(caseObj, 'security', 'security.evidence.added', {
        evidenceIds: [reasoning.id],
        type: 'inference',
      });

      // 3. ONE claim stating the least-privilege conclusion, linked ONLY to
      //    the evidence above (real KB hits + the inference entry). The
      //    verifier judges it on real material: if the KB read surfaced no
      //    corroborating source, the claim fails and the case clarifies —
      //    it never passes on invented provenance.
      const claim = addClaim(caseObj, {
        statement:
          'The missing permission is iam:PutRolePolicy on the CI/deployer identity. ' +
          'Scope it to the specific CAST AI role ARNs through the reviewed Terraform/CI ' +
          'path — least privilege, never Resource "*" and never IAMFullAccess.',
        needsVerification: true,
        evidenceIds: [...evidenceIds],
      });
      for (const evidenceId of evidenceIds) {
        linkEvidenceToClaim(caseObj, claim.id, evidenceId);
      }
      record(caseObj, 'security', 'security.claim.added', {
        claimId: claim.id,
        evidenceIds,
      });

      const risks = buildRisks();
      if (!caseObj.solution) {
        caseObj.solution = { status: 'none', summary: '', steps: [] };
      }
      if (!Array.isArray(caseObj.solution.steps)) caseObj.solution.steps = [];
      caseObj.solution.steps.push(...risks);
      if (caseObj.solution.status === 'none') caseObj.solution.status = 'proposed';
      record(caseObj, 'security', 'security.risks.appended', { risks: risks.length });

      return { evidenceAdded, risks };
    },
  };
}
