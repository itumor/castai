// BaseAgent — foundation for all swarm agents (chunk 13).
//
// Responsibilities:
//  - Validates the agent role key against the PERMISSIONS matrix (spec §4).
//  - Wraps the adapters object in a permission-filtered view: every adapter
//    whose PERMISSIONS[key][name] === 'none' throws PermissionError on any
//    property access (not just on call); allowed adapters pass through with
//    methods bound to the raw adapter.
//  - buildPrompt(): system role prompt + user message carrying the task and
//    the redacted ledger JSON.
//  - execute(): runs the subclass _run(task, ctx) inside try/catch, converts
//    outcomes/brain/tool errors into AgentResult, tracks the evidence ids the
//    agent appended, and records an audit entry.

import { PERMISSIONS, PermissionError } from '../permissions.js';
import { redact } from '../core/redact.js';
import { addEvidence, audit } from '../core/ledger.js';

export const ADAPTER_NAMES = ['castai', 'k8s', 'kb', 'sandbox', 'draft'];

/**
 * Build an AgentResult. On failure output is forced to null and the error
 * message is passed through redact(). Exported for reuse by chunk 14 agents
 * and their tests.
 *
 * @param {string} key agent role key
 * @param {boolean} ok
 * @param {object|null} output
 * @param {string[]} evidenceIds
 * @param {string|null} error
 */
export function buildAgentResult(key, ok, output, evidenceIds, error) {
  return {
    agent: key,
    ok: Boolean(ok),
    output: ok ? (output ?? null) : null,
    evidenceIds: ok && Array.isArray(evidenceIds) ? [...evidenceIds] : [],
    error: error ? redact(String(error)) : null,
  };
}

/** Wrap a single allowed adapter so method calls stay bound to the target. */
function permissionGuardedAdapter(key, adapterName, adapter) {
  return new Proxy(adapter, {
    get(target, prop) {
      if (PERMISSIONS[key][adapterName] === 'none') {
        throw new PermissionError(
          `PermissionError: agent '${key}' is not permitted to access adapter '${adapterName}' ` +
          `(permission level 'none')`
        );
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * Permission-filtered adapter view. Accessing a disallowed adapter name
 * throws PermissionError immediately; allowed names return a guarded proxy
 * of the raw adapter (or undefined when no adapter was supplied).
 */
function buildAdapterView(key, adapters) {
  const raw = adapters ?? {};
  return new Proxy({ __raw: raw }, {
    get(view, name) {
      if (typeof name !== 'string' || !ADAPTER_NAMES.includes(name)) return undefined;
      const level = PERMISSIONS[key]?.[name];
      if (level === undefined || level === 'none') {
        throw new PermissionError(
          `PermissionError: agent '${key}' is not permitted to access adapter '${name}' ` +
          `(permission level '${level ?? 'unknown'}')`
        );
      }
      const adapter = view.__raw[name];
      return adapter === undefined ? undefined : permissionGuardedAdapter(key, name, adapter);
    },
  });
}

function summarize(output) {
  try {
    const s = JSON.stringify(output);
    if (s === undefined) return String(output);
    return s.length > 300 ? `${s.slice(0, 300)}…` : s;
  } catch {
    return String(output);
  }
}

export class BaseAgent {
  /**
   * @param {{key: string, brain: object|null, ledger: object|null, adapters: object|null}} options
   */
  constructor({ key, brain = null, ledger = null, adapters = null } = {}) {
    if (!key || !PERMISSIONS[key]) {
      throw new Error(`BaseAgent: unknown agent key '${key}' — PERMISSIONS[key] must exist`);
    }
    this.key = key;
    this.brain = brain;
    this.ledger = ledger;
    this.adapters = buildAdapterView(key, adapters);
    // Subclasses override this with their own role prompt.
    this.rolePrompt = `You are the ${key} agent of the CAST AI support swarm. Reason carefully and answer with JSON when asked.`;
  }

  /**
   * Build the chat messages for a brain call: system role prompt + user
   * message with {task, ledger} where the ledger JSON is redacted.
   * @param {unknown} task
   * @returns {Array<{role: string, content: string}>}
   */
  buildPrompt(task) {
    const redactedLedger = JSON.parse(redact(JSON.stringify(this.ledger ?? null)));
    return [
      { role: 'system', content: this.rolePrompt },
      { role: 'user', content: JSON.stringify({ task, ledger: redactedLedger }) },
    ];
  }

  /**
   * Run the agent. Never throws: brain/tool errors are converted into an
   * ok:false AgentResult with a redacted error message. Evidence appended by
   * this run is collected into evidenceIds (empty on error).
   * @param {unknown} task
   * @returns {Promise<import('../core/types.js').AgentResult>}
   */
  async execute(task) {
    const ctx = {
      brain: this.brain,
      ledger: this.ledger,
      adapters: this.adapters,
      // Evidence results are redacted via the injectable redactFn slot.
      addEvidence: (e) => addEvidence(this.ledger, { ...e, toolRun: e.toolRun ?? null }, redact),
      audit: (action, detail) => audit(this.ledger, this.key, action, redact(String(detail))),
    };
    const evidenceBefore = this.ledger?.evidence?.length ?? 0;
    try {
      const output = await this._run(task, ctx);
      const evidenceIds = (this.ledger?.evidence ?? []).slice(evidenceBefore).map((e) => e.id);
      audit(this.ledger, this.key, 'execute', redact(summarize(output)));
      return buildAgentResult(this.key, true, output ?? null, evidenceIds, null);
    } catch (err) {
      const message = err?.message ?? String(err);
      audit(this.ledger, this.key, 'execute', redact(`error: ${message}`));
      return buildAgentResult(this.key, false, null, [], message);
    }
  }

  /** Subclasses override. Throwing from here yields an ok:false AgentResult. */
  async _run() {
    throw new Error(`BaseAgent: agent '${this.key}' must implement _run(task, ctx)`);
  }
}
