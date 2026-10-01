// src/agents/verifier.js — section 7 of CONTRACTS.md ("the strict gate").
//
// PASS/REJECT rule (binding):
//   normal mode — a needsVerification claim passes iff its claimClasses
//     contain a hard proof class (ENV_CONFIRMED | CODE_CONFIRMED |
//     TEST_CONFIRMED | REPRODUCED), OR at least TWO independent classes
//     incl. DOCUMENTED (documentation and api_spec map to the same
//     DOCUMENTED class, so docs+api alone is still ONE class).
//   strict mode (ctx.params.strictTwoSource === true) — every
//     needsVerification claim needs >=2 independent classes among
//     DOCUMENTED | ENV_CONFIRMED | CODE_CONFIRMED | TEST_CONFIRMED |
//     REPRODUCED (a single hard class is not enough).
// run also calls verifyClaims(caseObj) to flip verified statuses, and sets
// caseObj.verdict = { status:'PASS'|'REJECT', rejectedClaims: [{id, statement, missing}], at }.
// REJECT when ANY needsVerification claim fails OR there are zero
// evidence-backed claims.

import { claimClasses, verifyClaims } from '../core/model.js';
import { record } from '../core/trace.js';

/** Classes that count as hard proof on their own (normal mode). */
export const HARD_PROOF_CLASSES = [
  'ENV_CONFIRMED',
  'CODE_CONFIRMED',
  'TEST_CONFIRMED',
  'REPRODUCED',
];

/** Classes that count toward the two-source requirement in strictTwoSource mode. */
export const STRICT_QUALIFYING_CLASSES = ['DOCUMENTED', ...HARD_PROOF_CLASSES];

function normalPass(classes) {
  if (classes.some((cls) => HARD_PROOF_CLASSES.includes(cls))) return true;
  return classes.includes('DOCUMENTED') && classes.length >= 2;
}

function strictPass(classes) {
  return classes.filter((cls) => STRICT_QUALIFYING_CLASSES.includes(cls)).length >= 2;
}

function missingFor(classes, strict) {
  if (strict) {
    const qualifying = classes.filter((cls) => STRICT_QUALIFYING_CLASSES.includes(cls));
    return (
      'strictTwoSource requires >=2 independent classes among ' +
      `${STRICT_QUALIFYING_CLASSES.join(' | ')} (has ${qualifying.join(', ') || 'none'})`
    );
  }
  if (classes.length === 0) {
    return 'no linked evidence classes — claim has no supporting evidence';
  }
  if (classes.includes('DOCUMENTED')) {
    return (
      'DOCUMENTED alone is not enough — needs a second independent class or hard proof ' +
      `(${HARD_PROOF_CLASSES.join(' | ')})`
    );
  }
  return (
    `missing hard proof (${HARD_PROOF_CLASSES.join(' | ')}) or two independent ` +
    'classes incl. DOCUMENTED'
  );
}

/**
 * createVerifier({ llm, tools }) -> agent { id, name, async run(ctx) }.
 * The verifier uses no tools; it reads the case evidence ledger only.
 */
export function createVerifier({ llm, tools } = {}) {
  return {
    id: 'verifier',
    name: 'Verifier',

    async run(ctx) {
      const caseObj = ctx.caseObj;
      const params = ctx.params || {};
      const strict = params.strictTwoSource === true;

      record(caseObj, 'verifier', 'verifier.start', {
        strictTwoSource: strict,
        claims: (caseObj.claims || []).length,
      });

      // Flip verified statuses first (class >= ENV_CONFIRMED on the ladder).
      verifyClaims(caseObj);

      const rejectedClaims = [];
      let evidenceBacked = 0;

      for (const claim of caseObj.claims || []) {
        if (Array.isArray(claim.evidenceIds) && claim.evidenceIds.length > 0) {
          evidenceBacked += 1;
        }
        if (!claim.needsVerification) continue;

        const classes = claimClasses(caseObj, claim.id);
        const passes = strict ? strictPass(classes) : normalPass(classes);

        if (!passes) {
          claim.status = 'rejected';
          rejectedClaims.push({
            id: claim.id,
            statement: claim.statement,
            missing: missingFor(classes, strict),
          });
        } else if (claim.status === 'rejected') {
          // Loop-safe: evidence is append-only, so a claim rejected in an
          // earlier pass can pass once new evidence lands.
          claim.status = 'proposed';
        }
      }

      const status = rejectedClaims.length === 0 && evidenceBacked > 0 ? 'PASS' : 'REJECT';
      caseObj.verdict = {
        status,
        rejectedClaims,
        at: new Date().toISOString(),
      };

      record(caseObj, 'verifier', 'verifier.verdict', {
        status,
        rejectedClaims: rejectedClaims.length,
        evidenceBacked,
        strictTwoSource: strict,
      });

      return { verdict: caseObj.verdict };
    },
  };
}
