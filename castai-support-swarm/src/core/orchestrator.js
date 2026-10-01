// Orchestrator — explicit state machine driving the support swarm (chunk 15).
//
// The TRANSITIONS table (spec §4) is authoritative; the ASCII diagram in the
// spec is illustrative only. `_transition(event, reason)` is the ONLY mutation
// of case.status: it validates the (state, event) pair against the table,
// applies the VERIFY_FAIL loopsUsed guard and the LINT_FAIL retry-counter
// guard, appends to the state history and writes a ledger audit entry.
//
// State semantics (spec §4 "Event semantics"):
//   - VERIFY_FAIL: loopsUsed incremented FIRST; if loopsUsed < maxLoops →
//     'planning', else the event becomes ESCALATE → 'escalated'. Both
//     decisions are recorded in the history entry's reason.
//   - Confidence gate (inside 'verifying'): after a passing verdict the
//     orchestrator computes scoreFromLedger(ledger), stores it on
//     ledger.confidence, and emits ESCALATE ('low-confidence') instead of
//     VERIFY_PASS when score < 60 (solution.status becomes 'escalated' and
//     the plan's missingInfoQuestions feed the escalation agent).
//   - LINT_FAIL: stays in 'writing' (retry counter max 2); the third
//     LINT_FAIL becomes ESCALATE ('lint-failed').

import { TriageAgent } from '../agents/triage-agent.js';
import { SupervisorAgent } from '../agents/supervisor.js';
import { DocsResearcherAgent } from '../agents/docs-researcher.js';
import { SreInvestigatorAgent } from '../agents/sre-investigator.js';
import { ReproductionEngineerAgent } from '../agents/reproduction-engineer.js';
import { QaEngineerAgent } from '../agents/qa-engineer.js';
import { ProductEngineerAgent } from '../agents/product-engineer.js';
import { CloudSecurityEngineerAgent } from '../agents/cloud-security-engineer.js';
import { SolutionArchitectAgent } from '../agents/solution-architect.js';
import { VerifierAgent } from '../agents/verifier.js';
import { SupportWriterAgent } from '../agents/support-writer.js';
import { EscalationAgent } from '../agents/escalation-agent.js';
import { KnowledgeAgent } from '../agents/knowledge-agent.js';
import { createLedger, addHypothesis, setSolution, audit } from './ledger.js';
import { scoreFromLedger, routeFromScore } from './confidence.js';
import { validateCase } from './types.js';

export const TRANSITIONS = {
  intake:        { TRIAGED: 'triage' },
  // ESCALATE from triage/planning covers brain failures in the first two
  // states (escalationReason 'triage-failed'/'planning-failed'); intake has
  // no ESCALATE edge — an intake failure (invalid Case record) throws a
  // TypeError from run() before any state transition is attempted.
  triage:        { PLAN_READY: 'planning', ESCALATE: 'escalated' },
  planning:      { PLAN_BUILT: 'investigating', ESCALATE: 'escalated' },
  investigating: { INVESTIGATION_DONE: 'verifying' },
  verifying:     { VERIFY_PASS: 'writing', VERIFY_FAIL: 'planning', ESCALATE: 'escalated' },
  writing:       { DRAFT_OK: 'knowledge', LINT_FAIL: 'writing', ESCALATE: 'escalated' },
  knowledge:     { KNOWLEDGE_DONE: 'done' },
  escalated:     { DONE: 'done' },
};

/** Thrown when an event is not legal for the current state. */
export class InvalidTransitionError extends Error {
  constructor(state, event) {
    super(`InvalidTransitionError: event "${event}" is not legal in state "${state}"`);
    this.name = 'InvalidTransitionError';
    this.state = state;
    this.event = event;
  }
}

const SPECIALIST_CLASSES = {
  'docs-researcher': DocsResearcherAgent,
  'sre-investigator': SreInvestigatorAgent,
  'reproduction-engineer': ReproductionEngineerAgent,
  'qa-engineer': QaEngineerAgent,
  'product-engineer': ProductEngineerAgent,
  'cloud-security-engineer': CloudSecurityEngineerAgent,
  'solution-architect': SolutionArchitectAgent,
};

const MAX_LOOP_ITERATIONS = 50; // hard stop against a runaway state loop

// Verification ladder (spec §4 "Capability routing table", Decision Log rev 6):
// appended by the orchestrator to EVERY InvestigationPlan before fan-out —
// category-independent, so code/documentation evidence can always be paired
// with reproduction/test/telemetry evidence and fully_verified stays reachable.
const VERIFICATION_LADDER = Object.freeze([
  'sre-investigator', // environment confirmation
  'reproduction-engineer', // sandbox verification
  'qa-engineer', // sandbox verification
]);

/** Parse "From:"/"Subject:" headers out of a raw email string. */
function parseEmailText(raw) {
  const from = raw.match(/^From:\s*(.+)$/im)?.[1]?.trim() ?? 'unknown@unknown';
  const subject = raw.match(/^Subject:\s*(.+)$/im)?.[1]?.trim() ?? '(no subject)';
  const body = raw.replace(/^From:.*$/im, '').replace(/^Subject:.*$/im, '').trim();
  let fromName = '';
  const angled = from.match(/^"?(.+?)"?\s*<[^>]+>$/);
  if (angled) fromName = angled[1].trim();
  const fromFirstName = fromName ? (fromName.split(/\s+/)[0] ?? '') : '';
  return { from, fromName, fromFirstName, subject, body, thread: [] };
}

function normalizeEmail(emailInput) {
  if (typeof emailInput === 'string') return parseEmailText(emailInput);
  return emailInput;
}

/**
 * Build the per-specialist task from the supervisor's plain-text plan entry.
 * Passes BOTH the plain text and the structured fields (spec chunk 15); each
 * agent key additionally gets the structured field its contract requires.
 */
function buildSpecialistTask(key, taskText, triage, ledger) {
  const base = {
    text: taskText,
    clusterId: triage?.clusterId ?? null,
    hypotheses: ledger.hypotheses,
    scenario: triage?.issueCategory ?? null,
  };
  switch (key) {
    case 'docs-researcher':
      return { ...base, query: taskText, categoryHint: triage?.issueCategory ?? null };
    case 'product-engineer':
      return { ...base, questions: [taskText] };
    case 'cloud-security-engineer':
      return { ...base, focus: taskText, categoryHint: triage?.issueCategory ?? null };
    case 'solution-architect':
      return { ...base, proposedSolution: taskText, kbQuery: taskText };
    default:
      return base;
  }
}

function emptyAgentResult(key, error) {
  return { agent: key, ok: false, output: null, evidenceIds: [], error };
}

export class Orchestrator {
  /**
   * @param {{brain: object, adapters?: object|null, maxLoops?: number, caseId: string}} options
   */
  constructor({ brain, adapters = null, maxLoops = 2, caseId }) {
    if (!brain || typeof brain.complete !== 'function') {
      throw new TypeError('Orchestrator: brain with a complete(messages, opts) method is required');
    }
    if (typeof caseId !== 'string' || caseId.length === 0) {
      throw new TypeError('Orchestrator: caseId must be a non-empty string');
    }
    this.brain = brain;
    this.adapters = adapters ?? {};
    this.maxLoops = maxLoops;
    this.caseId = caseId;

    this.state = 'intake';
    this.history = [];
    this.ledger = null;
    // Lightweight case shell so _transition() (and its guards) are testable
    // in isolation; run() rebuilds the full Case record.
    this.case = {
      caseId, status: 'intake', loopsUsed: 0, maxLoops,
      lintRetries: 0,
    };
    this.verdict = null;
    this.lastVerdict = null;
    this.route = null;
    this.draftPost = null;
    this.escalationReason = null;
  }

  getState() {
    return { state: this.state, history: [...this.history] };
  }

  /**
   * The only mutation of case.status. Validates (state, event) against
   * TRANSITIONS, applies the VERIFY_FAIL / LINT_FAIL guards, records
   * {from, to, at, event, reason} in history and audits the ledger.
   * @param {string} event
   * @param {string} [reason]
   * @returns {Promise<{from: string, to: string, at: string, event: string, reason: string}>}
   */
  async _transition(event, reason = '') {
    const from = this.state;
    const allowed = TRANSITIONS[from];
    if (!allowed || !(event in allowed)) {
      throw new InvalidTransitionError(from, event);
    }

    let to = allowed[event];
    let finalEvent = event;
    let finalReason = reason;

    if (event === 'VERIFY_FAIL') {
      // Guard enforced here per spec: increment loopsUsed FIRST, then decide.
      this.case.loopsUsed += 1;
      if (this.case.loopsUsed < this.case.maxLoops) {
        finalReason =
          `${reason}; loopsUsed=${this.case.loopsUsed} < maxLoops=${this.case.maxLoops} → re-planning`;
      } else {
        finalEvent = 'ESCALATE';
        to = 'escalated';
        finalReason =
          `${reason}; loopsUsed=${this.case.loopsUsed} >= maxLoops=${this.case.maxLoops} → escalating`;
      }
    }

    if (event === 'LINT_FAIL') {
      this.case.lintRetries += 1;
      if (this.case.lintRetries > 2) {
        finalEvent = 'ESCALATE';
        to = 'escalated';
        finalReason = `${reason}; lint retries exhausted after ${this.case.lintRetries} failures → escalating`;
      } else {
        finalReason = `${reason}; lint retry ${this.case.lintRetries}/2 — staying in writing`;
      }
    }

    this.state = to;
    this.case.status = to;
    const entry = { from, to, at: new Date().toISOString(), event: finalEvent, reason: finalReason };
    this.history.push(entry);
    if (this.ledger) {
      audit(this.ledger, 'orchestrator', finalEvent, finalReason);
    }
    return entry;
  }

  /**
   * Run the full case. Agent instances are created here (one set per run
   * execution) and cached for the duration of the run.
   * @param {import('./types.js').EmailInput|string} emailInput
   * @returns {Promise<{caseRecord: object, ledger: object, verdict: object|null, draftPost: object|null}>}
   */
  async run(emailInput) {
    const email = normalizeEmail(emailInput);

    // 1. intake — build the Case record and a fresh ledger.
    this.case = {
      caseId: this.caseId,
      createdAt: new Date().toISOString(),
      source: 'email',
      email,
      status: 'intake',
      triage: null,
      plan: null,
      loopsUsed: 0,
      maxLoops: this.maxLoops,
      lintRetries: 0,
      draftPost: null,
      escalation: null,
      escalationReason: null,
      knowledgeProposals: null,
      investigation: null,
    };
    const caseValidation = validateCase(this.case);
    if (!caseValidation.ok) {
      throw new TypeError(`Orchestrator: invalid Case record: ${caseValidation.errors.join('; ')}`);
    }
    this.ledger = createLedger(this.caseId, null);
    this.state = 'intake';
    this.history = [];
    this.verdict = null;
    this.lastVerdict = null;
    this.route = null;
    this.draftPost = null;
    this.escalationReason = null;

    const agents = {};
    const makeAgent = (Cls, key) => {
      if (!agents[key]) agents[key] = new Cls({ key, brain: this.brain, ledger: this.ledger, adapters: this.adapters });
      return agents[key];
    };

    let iterations = 0;
    while (this.state !== 'done') {
      if (++iterations > MAX_LOOP_ITERATIONS) {
        throw new Error(`Orchestrator: state loop did not terminate (state=${this.state})`);
      }
      switch (this.state) {
        case 'intake':
          await this._transition('TRIAGED', 'email intake accepted');
          break;

        case 'triage': {
          const result = await makeAgent(TriageAgent, 'triage').execute({ email: this.case.email });
          if (!result.ok) {
            this.escalationReason = 'triage-failed';
            await this._transition('ESCALATE', `triage failed: ${result.error ?? 'unknown error'}`);
            break;
          }
          this.case.triage = result.output.triageFacts;
          this.ledger.provider = this.case.triage.provider;
          this.ledger.triage = this.case.triage; // cluster context for the confidence scorer
          await this._transition('PLAN_READY', `triage ok: ${this.case.triage.issueCategory}`);
          break;
        }

        case 'planning': {
          const result = await makeAgent(SupervisorAgent, 'supervisor').execute({
            triage: this.case.triage,
            openQuestions: this.lastVerdict?.openQuestions ?? [],
          });
          if (!result.ok) {
            this.escalationReason = 'planning-failed';
            await this._transition('ESCALATE', `supervisor failed: ${result.error ?? 'unknown error'}`);
            break;
          }
          this.case.plan = result.output.plan;
          await this._transition('PLAN_BUILT', `plan: [${this.case.plan.agentSubset.join(',')}]`);
          break;
        }

        case 'investigating': {
          await this._investigate(makeAgent);
          break;
        }

        case 'verifying': {
          const result = await makeAgent(VerifierAgent, 'verifier').execute({});
          if (result.ok && result.output?.verdict?.pass === true) {
            this.verdict = result.output.verdict;
            this.lastVerdict = this.verdict;
            // Confidence gate — deterministic, recomputed here (never by an LLM).
            const score = scoreFromLedger(this.ledger);
            this.ledger.confidence = score;
            if (score < 60) {
              setSolution(this.ledger, 'escalated', this.ledger.solution.summary);
              this.escalationReason = 'low-confidence';
              await this._transition('ESCALATE', `low-confidence: score ${score} < 60`);
            } else {
              this.route = routeFromScore(score);
              await this._transition('VERIFY_PASS', `score ${score}, route ${this.route}`);
            }
          } else {
            this.verdict = result.output?.verdict ?? this.lastVerdict;
            this.lastVerdict = this.verdict;
            await this._transition(
              'VERIFY_FAIL',
              result.error ?? this.verdict?.reason ?? 'verification failed'
            );
          }
          break;
        }

        case 'writing': {
          const writer = makeAgent(SupportWriterAgent, 'support-writer');
          let task = {
            verdict: this.verdict,
            route: this.route,
            to: this.case.email.from,
            subject: this.case.email.subject,
          };
          for (;;) {
            const result = await writer.execute(task);
            if (result.ok) {
              this.case.draftPost = result.output.draft;
              this.draftPost = result.output.draft;
              await this._transition('DRAFT_OK', 'draft composed and lint-clean');
              break;
            }
            const lintFailure = /lint/i.test(result.error ?? '');
            if (!lintFailure) {
              this.escalationReason = 'writer-failed';
              await this._transition('ESCALATE', `writer failed: ${result.error ?? 'unknown error'}`);
              break;
            }
            await this._transition('LINT_FAIL', result.error ?? 'draft failed the claim-honesty lint');
            if (this.state !== 'writing') break; // third failure escalated inside _transition
            task = { ...task, lintViolations: [result.error] };
          }
          break;
        }

        case 'knowledge': {
          // Non-fatal: a knowledge-agent failure must not sink a finished case.
          const result = await makeAgent(KnowledgeAgent, 'knowledge-agent').execute({});
          if (result.ok) {
            this.case.knowledgeProposals = result.output.proposals;
          } else {
            audit(this.ledger, 'orchestrator', 'knowledge-skipped', result.error ?? 'knowledge agent failed');
          }
          await this._transition('KNOWLEDGE_DONE', 'knowledge proposals handled');
          break;
        }

        case 'escalated': {
          const openQuestions =
            this.lastVerdict?.openQuestions ??
            (Array.isArray(this.case.plan?.missingInfoQuestions)
              ? this.case.plan.missingInfoQuestions
              : []);
          const result = await makeAgent(EscalationAgent, 'escalation-agent').execute({
            reason: this.escalationReason ?? 'unspecified',
            openQuestions,
          });
          this.case.escalationReason = this.escalationReason;
          if (result.ok) {
            this.case.escalation = result.output.escalationPackage;
          } else {
            // Agent failed (e.g. brain outage): record the outcome on the case
            // record so runCase can still emit a minimal escalation.json.
            // result.error is already redacted by BaseAgent.execute.
            this.case.escalationError = result.error ?? 'escalation agent failed';
            audit(this.ledger, 'orchestrator', 'escalation-incomplete', result.error ?? 'escalation agent failed');
          }
          await this._transition('DONE', 'escalation package built');
          break;
        }

        default:
          throw new InvalidTransitionError(this.state, '(no handler)');
      }
    }

    return { caseRecord: this.case, ledger: this.ledger, verdict: this.verdict, draftPost: this.draftPost };
  }

  /** 'investigating' state body: seed hypotheses, fan out specialists, propose a solution. */
  async _investigate(makeAgent) {
    const triage = this.case.triage;
    const plan = this.case.plan;

    // (0) Verification ladder — extend the plan's agentSubset (deduplicated)
    // before seeding hypotheses / fanning out (spec §4, Decision Log rev 6).
    const baseSubset = Array.isArray(plan?.agentSubset) ? plan.agentSubset : [];
    const appended = VERIFICATION_LADDER.filter((key) => !baseSubset.includes(key));
    if (plan) plan.agentSubset = [...baseSubset, ...appended];
    audit(
      this.ledger,
      'orchestrator',
      'verification-ladder',
      appended.length > 0
        ? `appended [${appended.join(',')}] to agentSubset [${[...baseSubset, ...appended].join(',')}]`
        : 'ladder already present in agentSubset'
    );

    // (1) Seed 1–3 hypotheses via the brain; tolerate any failure.
    let statements = null;
    try {
      const raw = await this.brain.complete(
        [{
          role: 'user',
          content: JSON.stringify({
            instruction: 'Seed 1-3 investigation hypotheses. Respond ONLY with a JSON array of hypothesis statement strings.',
            email: { subject: this.case.email.subject, body: this.case.email.body },
            triage,
          }),
        }],
        { json: true, tag: 'seed-hypotheses' }
      );
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        statements = parsed
          .map((s) => (typeof s === 'string' ? s.trim() : ''))
          .filter((s) => s.length > 0)
          .slice(0, 3);
      }
    } catch {
      statements = null;
    }
    if (!statements || statements.length === 0) statements = ['pending investigation'];
    for (const statement of statements) addHypothesis(this.ledger, statement);

    // (2) Fan out every planned specialist. A failure becomes an ok:false
    // AgentResult recorded on the case — it never aborts the fan-out.
    const subset = Array.isArray(plan?.agentSubset) ? plan.agentSubset : [];
    const settled = await Promise.allSettled(
      subset.map(async (key) => {
        const Cls = SPECIALIST_CLASSES[key];
        if (!Cls) return emptyAgentResult(key, `no agent class for key '${key}'`);
        const taskText = plan?.tasksPerAgent?.[key] ?? `Investigate the ${triage?.issueCategory ?? 'reported'} issue`;
        const task = buildSpecialistTask(key, taskText, triage, this.ledger);
        return makeAgent(Cls, key).execute(task);
      })
    );
    const results = settled.map((outcome, i) =>
      outcome.status === 'fulfilled'
        ? outcome.value
        : emptyAgentResult(subset[i], outcome.reason?.message ?? String(outcome.reason))
    );
    this.case.investigation = { results };
    for (const r of results) {
      if (!r.ok) audit(this.ledger, 'orchestrator', 'specialist-failed', `${r.agent}: ${r.error ?? 'failed'}`);
    }
    const okCount = results.filter((r) => r.ok).length;
    audit(this.ledger, 'orchestrator', 'fan-out-settled', `${okCount}/${results.length} specialists ok`);

    // (3) Propose a solution when a hypothesis was confirmed; otherwise unsolved.
    const confirmed = this.ledger.hypotheses.filter((h) => h.status === 'confirmed');
    if (confirmed.length > 0) {
      const summary = await this._proposeSolution(confirmed);
      setSolution(this.ledger, 'proposed', summary);
    } else {
      setSolution(this.ledger, 'unsolved', null);
    }

    await this._transition(
      'INVESTIGATION_DONE',
      `${okCount}/${results.length} specialists settled; solution ${this.ledger.solution.status}`
    );
  }

  /** Brain call proposing a 2–4 sentence solution from the confirmed hypotheses. */
  async _proposeSolution(confirmed) {
    const fallback = confirmed.map((h) => h.statement).join('; ');
    try {
      const topEvidence = this.ledger.evidence.slice(-5).map((e) => `${e.id} (${e.type}): ${e.result}`);
      const raw = await this.brain.complete(
        [{
          role: 'user',
          content: JSON.stringify({
            instruction: 'Propose the solution for the customer in 2-4 sentences, grounded only in the confirmed hypotheses and evidence. Respond with plain prose.',
            confirmedHypotheses: confirmed.map((h) => h.statement),
            evidence: topEvidence,
          }),
        }],
        { tag: 'propose-solution' }
      );
      const summary = String(raw).trim();
      return summary.length > 0 ? summary : fallback;
    } catch {
      return fallback;
    }
  }
}
