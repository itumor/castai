// Permissions matrix (spec §4, verbatim).
// Maps agent key → per-adapter access level.
// Levels: 'read' | 'write-sandbox' | 'write-draft' | 'none'
//   - 'read'          satisfies 'read'
//   - 'write-sandbox' satisfies 'read' + 'write-sandbox'
//   - 'write-draft'   satisfies 'read' + 'write-draft'
//   - 'none'          satisfies nothing

export const PERMISSIONS = Object.freeze({
  'supervisor':              { castai: 'none',           k8s: 'none',           kb: 'read',           sandbox: 'none',           draft: 'none'           },
  'triage':                  { castai: 'none',           k8s: 'none',           kb: 'read',           sandbox: 'none',           draft: 'none'           },
  'docs-researcher':         { castai: 'none',           k8s: 'none',           kb: 'read',           sandbox: 'none',           draft: 'none'           },
  'sre-investigator':        { castai: 'read',           k8s: 'read',           kb: 'none',           sandbox: 'none',           draft: 'none'           },
  'cloud-security-engineer': { castai: 'read',           k8s: 'none',           kb: 'read',           sandbox: 'none',           draft: 'none'           },
  'reproduction-engineer':   { castai: 'none',           k8s: 'none',           kb: 'none',           sandbox: 'write-sandbox',  draft: 'none'           },
  'qa-engineer':             { castai: 'none',           k8s: 'none',           kb: 'none',           sandbox: 'write-sandbox',  draft: 'none'           },
  'product-engineer':        { castai: 'read',           k8s: 'none',           kb: 'read',           sandbox: 'none',           draft: 'none'           },
  'solution-architect':      { castai: 'read',           k8s: 'none',           kb: 'read',           sandbox: 'none',           draft: 'none'           },
  'verifier':                { castai: 'read',           k8s: 'read',           kb: 'read',           sandbox: 'none',           draft: 'none'           },
  'support-writer':          { castai: 'none',           k8s: 'none',           kb: 'none',           sandbox: 'none',           draft: 'write-draft'    },
  'escalation-agent':        { castai: 'none',           k8s: 'none',           kb: 'read',           sandbox: 'none',           draft: 'none'           },
  'knowledge-agent':         { castai: 'none',           k8s: 'none',           kb: 'read',           sandbox: 'none',           draft: 'none'           },
});

const ADAPTERS = ['castai', 'k8s', 'kb', 'sandbox', 'draft'];

// Levels granted by each permission level (a level satisfies an operation if
// the operation is in its satisfaction set).
const SATISFIES = {
  'read':          new Set(['read']),
  'write-sandbox': new Set(['read', 'write-sandbox']),
  'write-draft':   new Set(['read', 'write-draft']),
  'none':          new Set([]),
};

export class PermissionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermissionError';
  }
}

/**
 * Throws PermissionError if `agentKey` is not allowed to perform `operation`
 * on `adapterName`. Also throws on unknown agent key or adapter name.
 * Error messages always name the agent, adapter, and operation.
 */
export function assertAllowed(agentKey, adapterName, operation) {
  const ctx = `agent='${agentKey}' adapter='${adapterName}' operation='${operation}'`;
  const entry = PERMISSIONS[agentKey];
  if (!entry) {
    throw new PermissionError(`PermissionError: unknown agent key ${ctx}`);
  }
  if (!ADAPTERS.includes(adapterName)) {
    throw new PermissionError(`PermissionError: unknown adapter name ${ctx}`);
  }
  const level = entry[adapterName];
  if (!SATISFIES[level] || !SATISFIES[level].has(operation)) {
    throw new PermissionError(
      `PermissionError: agent '${agentKey}' has level '${level}' on adapter '${adapterName}', insufficient for operation '${operation}'`
    );
  }
}
