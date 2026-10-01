// src/core/llm.js — section 2 of CONTRACTS.md
// LLM abstraction. HeuristicLlm is the offline deterministic "brain" so the
// whole system works without API keys; HttpLlm is the live --live mode.
// Secrets (api keys) are used in request headers only — never logged.

// ---------------------------------------------------------------------------
// Intent: triage — keyword rules from section 7 (triage agent contract).
// Evaluated in contract order; first match wins.
// ---------------------------------------------------------------------------

const TRIAGE_CATEGORY_RULES = [
  // 'scal' + 'down|not scale|stuck' -> node_downscale
  (t) => /scal/i.test(t) && /down|not scale|stuck/i.test(t) ? 'node_downscale' : null,
  // 'PutRolePolicy|AccessDenied|403|onboard' -> iam_onboarding
  (t) => (/putrolepolicy|accessdenied|403|onboard/i.test(t) ? 'iam_onboarding' : null),
  // '401|token|authoriz' -> token_rotation
  (t) => (/401|token|authoriz/i.test(t) ? 'token_rotation' : null),
  // 'savings|cost|billing method|formula|baseline' -> cost_reporting
  (t) => (/savings|cost|billing method|formula|baseline/i.test(t) ? 'cost_reporting' : null),
  // 'workload autoscal|recommendation|vpa|hpa' -> workload_autoscaling
  (t) => (/workload autoscal|recommendation|vpa|hpa/i.test(t) ? 'workload_autoscaling' : null),
  // 'spot' -> spot
  (t) => (/spot/i.test(t) ? 'spot' : null),
  // 'how do|documentation|docs' (only when nothing else matched) -> docs_question
  (t) => (/how do|documentation|docs/i.test(t) ? 'docs_question' : null),
];

function detectCategory(text) {
  for (const rule of TRIAGE_CATEGORY_RULES) {
    const hit = rule(text);
    if (hit) return hit;
  }
  return 'unknown';
}

function detectProvider(text) {
  if (/aws|amazon|\beks\b/i.test(text)) return 'aws';
  if (/azure|\baks\b/i.test(text)) return 'azure';
  if (/gcp|google cloud|\bgke\b/i.test(text)) return 'gcp';
  return 'unknown';
}

function detectPlatform(text) {
  if (/\beks\b/i.test(text)) return 'eks';
  if (/\baks\b/i.test(text)) return 'aks';
  if (/\bgke\b/i.test(text)) return 'gke';
  return 'unknown';
}

function detectCastaiMode(text) {
  if (/read[- ]?only/i.test(text)) return 'readonly';
  if (/\bfull(\s|-)?(mode|autoscal)/i.test(text)) return 'full';
  if (/workload[- ]autoscal/i.test(text)) return 'workload-autoscaler';
  if (/\bnode[- ]autoscal|karpenter/i.test(text)) return 'node-autoscaler';
  return 'unknown';
}

function extractQuestions(text) {
  const matches = text.match(/[^.!?\n]+\?/g);
  if (!matches) return [];
  return matches.map((q) => q.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function detectSeverity(text) {
  if (/\b(p1|sev-?1|outage|production down|urgent|critical)\b/i.test(text)) return 'high';
  if (/\b(p2|sev-?2|degraded|intermittent)\b/i.test(text)) return 'medium';
  return 'low';
}

const ID_PATTERN = '([0-9a-fA-F][0-9a-fA-F-]{5,})';

function extractEntities(text) {
  const entities = {};
  const org = text.match(new RegExp(`org(?:anization)?[-_ ]?id\\s*[:=]?\\s*${ID_PATTERN}`, 'i'));
  if (org) entities.orgId = org[1];
  const cluster = text.match(new RegExp(`cluster[-_ ]?id\\s*[:=]?\\s*${ID_PATTERN}`, 'i'));
  if (cluster) entities.clusterId = cluster[1];
  return entities;
}

/** customerName: first token of the From: display name, or salutation "Hi X,". */
function extractCustomerName(text) {
  const from = text.match(/^From:\s*(.+)$/im);
  if (from) {
    const display = from[1].replace(/<[^>]*>/g, '').replace(/["']/g, '').trim();
    for (const token of display.split(/\s+/)) {
      const clean = token.replace(/[^A-Za-z'’-]/g, '');
      if (/^[A-Za-z]/.test(clean)) return clean;
    }
  }
  const salutation = text.match(/\bHi\s+([A-Z][A-Za-z'’-]+)/);
  if (salutation) return salutation[1];
  return '';
}

function buildTriageResult(text) {
  const entities = extractEntities(text);
  const missingInfo = [];
  if (!entities.orgId) missingInfo.push('orgId');
  if (!entities.clusterId) missingInfo.push('clusterId');
  return {
    category: detectCategory(text),
    provider: detectProvider(text),
    platform: detectPlatform(text),
    castaiMode: detectCastaiMode(text),
    questions: extractQuestions(text),
    severity: detectSeverity(text),
    missingInfo,
    entities,
    customerName: extractCustomerName(text),
  };
}

// ---------------------------------------------------------------------------
// Intent: plan — best-effort; the supervisor clamps via PLAN_TEMPLATES anyway,
// so offer the full roster in canonical registry order.
// ---------------------------------------------------------------------------

const HEURISTIC_PLAN_AGENTS = [
  'supervisor',
  'triage',
  'researcher',
  'sre',
  'repro',
  'qa',
  'product',
  'architect',
  'security',
  'verifier',
  'writer',
  'escalation',
  'knowledge',
];

// ---------------------------------------------------------------------------
// Intent: writer — assemble a plain, human-sounding draft from data listed in
// the prompt. Deterministic, no first-person action claims, no AI-ish filler.
// ---------------------------------------------------------------------------

function buildWriterDraft(text) {
  const name = extractCustomerName(text) || 'there';
  const bullets = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/[.\s]+$/, ''))
    .filter(Boolean)
    .slice(0, 5);

  const parts = [`Hi ${name},`];
  if (bullets.length > 0) {
    parts.push('', "Here's what we found:");
    for (const bullet of bullets) parts.push(`- ${bullet}.`);
  }
  parts.push(
    '',
    "If you can share any extra detail, just reply here and we'll keep digging.",
    '',
    '— CAST AI Support',
  );
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// HeuristicLlm
// ---------------------------------------------------------------------------

export class HeuristicLlm {
  /**
   * complete({ system, prompt, json }) -> Promise<string>
   * Recognises intents by scanning prompt text (case-insensitive keywords):
   *  - 'triage' -> JSON TriageResult built from deterministic keyword rules
   *  - 'plan'   -> JSON { agents: [...] } (best-effort; supervisor clamps)
   *  - 'writer' -> plain human-sounding draft assembled from the prompt data
   * Otherwise returns '{}'.
   */
  async complete({ system, prompt, json } = {}) {
    const text = `${system || ''}\n${prompt || ''}`;
    if (/\btriage\b/i.test(text)) {
      return JSON.stringify(buildTriageResult(prompt || system || ''));
    }
    if (/\bplan\b/i.test(text)) {
      // Best-effort: offer the full roster; the supervisor intersects/orders
      // by PLAN_TEMPLATES[caseObj.triage.category] and never returns fewer.
      return JSON.stringify({ agents: [...HEURISTIC_PLAN_AGENTS] });
    }
    if (/\bwriter\b/i.test(text)) {
      return buildWriterDraft(prompt || system || '');
    }
    return '{}';
  }
}

// ---------------------------------------------------------------------------
// HttpLlm
// ---------------------------------------------------------------------------

export class HttpLlm {
  constructor({ provider = 'anthropic', apiKey, model, fetchImpl } = {}) {
    if (provider !== 'anthropic' && provider !== 'openai') {
      throw new Error(`Unsupported LLM provider: ${provider}`);
    }
    this.provider = provider;
    this.apiKey = apiKey;
    this.model = model || (provider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini');
    this.fetchImpl = fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('HttpLlm requires a fetch implementation (fetchImpl)');
    }
  }

  /** complete({ system, prompt, json }) -> Promise<string> */
  async complete({ system, prompt, json } = {}) {
    if (this.provider === 'openai') return this.#completeOpenAi({ system, prompt, json });
    return this.#completeAnthropic({ system, prompt, json });
  }

  async #completeAnthropic({ system, prompt, json }) {
    const sysParts = [];
    if (system) sysParts.push(system);
    if (json) sysParts.push('Respond with valid JSON only. No prose, no markdown fences.');
    const body = {
      model: this.model,
      max_tokens: 4096,
      system: sysParts.join('\n'),
      messages: [{ role: 'user', content: prompt || '' }],
    };
    const res = await this.fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Anthropic API error: HTTP ${res.status}`);
    const data = await res.json();
    const blocks = Array.isArray(data && data.content) ? data.content : [];
    return blocks
      .filter((block) => block && block.type === 'text')
      .map((block) => block.text)
      .join('');
  }

  async #completeOpenAi({ system, prompt, json }) {
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt || '' });
    const body = { model: this.model, messages };
    if (json) body.response_format = { type: 'json_object' };
    const res = await this.fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenAI API error: HTTP ${res.status}`);
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : undefined;
    return typeof content === 'string' ? content : '';
  }
}

// ---------------------------------------------------------------------------
// defaultLlm + jsonOnly
// ---------------------------------------------------------------------------

/** defaultLlm(env = process.env) -> HttpLlm when an API key is present, else HeuristicLlm. */
export function defaultLlm(env = process.env) {
  if (env.ANTHROPIC_API_KEY) {
    return new HttpLlm({ provider: 'anthropic', apiKey: env.ANTHROPIC_API_KEY });
  }
  if (env.OPENAI_API_KEY) {
    return new HttpLlm({ provider: 'openai', apiKey: env.OPENAI_API_KEY });
  }
  return new HeuristicLlm();
}

/** Scan candidate for the first balanced block starting at index `start`. */
function firstBalancedBlock(candidate, start) {
  if (start === -1) return null;
  const open = candidate[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i += 1) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * jsonOnly(text) -> any — tolerant JSON extraction:
 * strips ```json / ``` fences, skips leading prose. Object-preferred: the
 * first balanced {...} block wins when one exists (the triage JSON is an
 * object — a stray '[1]' in prose must not shadow it); otherwise the first
 * balanced [...] block is used. Returns {} when nothing parses.
 */
export function jsonOnly(text) {
  if (text === null || text === undefined) return {};
  if (typeof text === 'object') return text;
  let candidate = String(text).trim();

  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1].trim();

  try {
    return JSON.parse(candidate);
  } catch {
    // fall through to prose-skipping extraction
  }

  for (const open of ['{', '[']) {
    const block = firstBalancedBlock(candidate, candidate.indexOf(open));
    if (block === null) continue;
    try {
      return JSON.parse(block);
    } catch {
      // try the next bracket class
    }
  }
  return {};
}
