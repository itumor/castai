// src/core/policy.js — section 3 of CONTRACTS.md
// Permission policy: which agent may use which tool, which API paths and
// kubectl invocations stay read-only, and secret redaction.
//
// Safety (root AGENTS.md): read-only posture. Nothing here ever sends email,
// issues non-GET HTTP against CAST AI/Kubernetes, mutates a cluster, or
// prints/persists secrets.

export class PolicyError extends Error {}

export const AGENT_PERMISSIONS = {
  supervisor: { tools: [], writes: ['plan'] },
  triage: { tools: ['kb'] },
  researcher: { tools: ['kb', 'docsSearch'] },
  sre: { tools: ['kube', 'castai', 'lab'] },
  repro: { tools: ['lab'] },
  qa: { tools: ['lab', 'testRunner'] },
  product: { tools: ['kb', 'repoSearch'] },
  architect: { tools: ['kb'] },
  security: { tools: ['kb'] },
  verifier: { tools: ['kb'] },
  writer: { tools: ['emailDraft'] },
  escalation: { tools: ['kb'] },
  knowledge: { tools: ['kb', 'kbWrite'] },
};

/** assertToolAllowed(agentId, toolName) — throws PolicyError when not listed. */
export function assertToolAllowed(agentId, toolName) {
  const permissions = AGENT_PERMISSIONS[agentId];
  if (!permissions) {
    throw new PolicyError(`Unknown agent: ${agentId} (tool requested: ${toolName})`);
  }
  if (!permissions.tools.includes(toolName)) {
    throw new PolicyError(`Agent '${agentId}' is not allowed to use tool '${toolName}'`);
  }
}

/** CAST AI API paths that stay within read-only scopes. */
export const CASTAI_READ_PATHS = [
  /^\/v1\/organizations(\/|$)/,
  /^\/v1\/kubernetes\/external-clusters(\/|$)/,
  /^\/v1\/cost-reports(\/|$)/,
  /^\/v1\/workload-autoscaling(\/|$)/,
  /^\/v1\/inventory(\/|$)/,
  /^\/v1\/recommendations(\/|$)/,
  /^\/v1\/pricing(\/|$)/,
];

/** assertCastaiReadPath(path) — throws PolicyError unless path matches CASTAI_READ_PATHS. */
export function assertCastaiReadPath(path) {
  if (typeof path !== 'string' || !CASTAI_READ_PATHS.some((rx) => rx.test(path))) {
    throw new PolicyError(`CAST AI path is not on the read-only allow-list: ${path}`);
  }
}

export const KUBECTL_READ_VERBS = [
  'get',
  'describe',
  'logs',
  'top',
  'explain',
  'api-resources',
  'version',
  'config',
];

// Verbs/tokens that must never appear anywhere in a kubectl invocation.
const KUBECTL_FORBIDDEN_TOKENS = [
  'exec',
  'apply',
  'delete',
  'edit',
  'patch',
  'cp',
  'port-forward',
  'attach',
];

// The only `kubectl config` subcommands that cannot mutate kubeconfig. Every
// other config subcommand (use-context, set-context, delete-cluster, ...)
// rewrites or deletes kubeconfig entries -> forbidden.
const KUBECTL_CONFIG_READ_SUBCOMMANDS = ['get-contexts', 'current-context', 'view'];

// Auth/impersonation flags forbidden in BOTH forms: '--flag=value' and the
// space-separated '--flag value' (kubectl's pflag treats them identically).
const KUBECTL_FORBIDDEN_FLAGS = [
  '--server',
  '-s',
  '--token',
  '--kubeconfig',
  '--context',
  '--as',
  '--as-group',
  '--username',
  '--password',
  '--client-certificate',
  '--client-key',
  '--certificate-authority',
];

// '--raw' would let the caller hit arbitrary API-server paths (path injection
// around the resource checks below), so it is forbidden outright.
const KUBECTL_FORBIDDEN_RAW = '--raw';

// Resources that must never be read through this tool: their payloads are
// secret material by definition.
const KUBECTL_FORBIDDEN_RESOURCES = new Set(['secret', 'secrets']);
const KUBECTL_SECRET_READ_VERBS = new Set(['get', 'describe', 'logs']);

/**
 * assertKubectlArgs(args /* string[] *\/) — throws PolicyError unless args[0]
 * is a read-only verb and no argument carries a dangerous verb/flag.
 * ('--follow=false' and similar benign output flags are fine.)
 */
export function assertKubectlArgs(args) {
  if (!Array.isArray(args) || args.length === 0 || typeof args[0] !== 'string') {
    throw new PolicyError('kubectl args must be a non-empty string array');
  }
  const verb = args[0];
  if (!KUBECTL_READ_VERBS.includes(verb)) {
    throw new PolicyError(`kubectl verb is not read-only: ${verb}`);
  }

  // 'config' is whitelisted as a verb but only its read-only subcommands.
  if (verb === 'config') {
    const sub = args.slice(1).find((a) => typeof a === 'string' && !a.startsWith('-'));
    if (sub === undefined || !KUBECTL_CONFIG_READ_SUBCOMMANDS.includes(sub)) {
      throw new PolicyError(
        `kubectl config subcommand is not read-only: ${sub ?? '(none)'} ` +
        `(allowed: ${KUBECTL_CONFIG_READ_SUBCOMMANDS.join(', ')})`,
      );
    }
  }

  for (const arg of args) {
    if (typeof arg !== 'string') {
      throw new PolicyError('kubectl args must all be strings');
    }
    const lower = arg.toLowerCase();
    if (KUBECTL_FORBIDDEN_TOKENS.includes(lower)) {
      throw new PolicyError(`kubectl argument is not allowed (read-only): ${arg}`);
    }
    for (const flag of KUBECTL_FORBIDDEN_FLAGS) {
      // Catches every form: '--flag' (its value would be the next arg),
      // '--flag=value' and '-s'/'-s=value'. kubectl's pflag assigns them all
      // the same meaning, so the read-only guard must name them all.
      if (lower === flag || lower.startsWith(`${flag}=`)) {
        throw new PolicyError(`kubectl flag is not allowed (read-only): ${arg}`);
      }
    }
    if (lower === KUBECTL_FORBIDDEN_RAW || lower.startsWith(`${KUBECTL_FORBIDDEN_RAW}=`)) {
      throw new PolicyError(`kubectl --raw is not allowed (path injection): ${arg}`);
    }
  }

  // Secret material must never flow into the ledger — block it as a resource.
  if (KUBECTL_SECRET_READ_VERBS.has(verb)) {
    for (const arg of args.slice(1)) {
      if (typeof arg === 'string' && KUBECTL_FORBIDDEN_RESOURCES.has(arg.toLowerCase())) {
        throw new PolicyError(`kubectl ${verb} of secrets is not allowed (secret material): ${arg}`);
      }
    }
  }
}

export const SENSITIVE_KEYS = [
  'token',
  'secret',
  'password',
  'apikey',
  'api_key',
  'authorization',
  'credential',
];

const REDACTED = '***REDACTED***';

// Secret-shaped string material (contract §3): these never survive a mask pass.
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const AWS_KEY_PATTERN = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
const LONG_HEX_PATTERN = /\b[0-9a-fA-F]{32,}\b/g; // api tokens, fingerprints
// 'sensitiveWord: value' / 'sensitiveWord = value' (quoted or not, >= 8 chars,
// and never the REDACTED literal itself).
const KV_PATTERN = /(\b(?:token|secret|password|api[-_]?key|authorization|credential)\w*)\s*[:=]\s*("?)(?!\*{3})[^\s"',}]{8,}\2/gi;

/**
 * maskSecretsString(text) — replace secret-shaped material inside a plain
 * string with '***REDACTED***': sensitive key:value pairs, Bearer/JWT/
 * AWS-key/long-hex shapes. Non-strings pass through unchanged.
 */
export function maskSecretsString(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  return text
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(JWT_PATTERN, REDACTED)
    .replace(AWS_KEY_PATTERN, REDACTED)
    .replace(LONG_HEX_PATTERN, REDACTED)
    .replace(KV_PATTERN, (match, key, quote) => `${key}= ${quote}${REDACTED}${quote}`);
}

/**
 * redact(value) -> deep-cloned value where any object key whose lowercase
 * name contains a SENSITIVE_KEYS entry is replaced by '***REDACTED***', and
 * any STRING value embedding secret-shaped material is masked via
 * maskSecretsString. Never mutates the input. Works at any nesting depth
 * (objects + arrays). Bare strings are NOT keys: they are returned as-is
 * unless they embed secret-shaped material.
 */
export function redact(value) {
  if (typeof value === 'string') {
    return maskSecretsString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, sub] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.some((sensitive) => lowerKey.includes(sensitive))) {
        out[key] = REDACTED;
      } else {
        out[key] = redact(sub);
      }
    }
    return out;
  }
  return value;
}
