// src/agents/triage.js — contract section 7 (triage agent).
//
// createTriage({ llm, tools }): builds a TriageResult via the injected llm
// (offline: HeuristicLlm keyword rules from src/core/llm.js) and stores it on
// caseObj.triage. The raw LLM output is normalised/clamped to the contract
// enums so downstream agents (supervisor, researcher) can trust the shape.

import { AGENT_PERMISSIONS } from '../core/policy.js';
import { jsonOnly } from '../core/llm.js';
import { record } from '../core/trace.js';
import { createAgent } from './base.js';
import { ISSUE_CATEGORIES } from './registry.js';

const PROVIDERS = ['aws', 'azure', 'gcp', 'unknown'];
const PLATFORMS = ['eks', 'aks', 'gke', 'unknown'];
const CASTAI_MODES = ['readonly', 'workload-autoscaler', 'node-autoscaler', 'full', 'unknown'];
const SEVERITIES = ['low', 'medium', 'high'];

function enumOr(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.length > 0) : [];
}

/** Clamp arbitrary llm output to the exact TriageResult shape from the contract. */
export function normalizeTriageResult(parsed) {
  const src = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const entities = src.entities && typeof src.entities === 'object' ? src.entities : {};
  const cleanEntities = {};
  if (typeof entities.clusterId === 'string' && entities.clusterId) {
    cleanEntities.clusterId = entities.clusterId;
  }
  if (typeof entities.orgId === 'string' && entities.orgId) {
    cleanEntities.orgId = entities.orgId;
  }
  return {
    category: enumOr(src.category, ISSUE_CATEGORIES, 'unknown'),
    provider: enumOr(src.provider, PROVIDERS, 'unknown'),
    platform: enumOr(src.platform, PLATFORMS, 'unknown'),
    castaiMode: enumOr(src.castaiMode, CASTAI_MODES, 'unknown'),
    questions: stringArray(src.questions),
    severity: enumOr(src.severity, SEVERITIES, 'low'),
    missingInfo: stringArray(src.missingInfo),
    entities: cleanEntities,
    customerName: typeof src.customerName === 'string' ? src.customerName : '',
  };
}

/** Flatten a case thread ({ from, subject, messages }) into plain text for the llm. */
export function threadToText(thread) {
  if (!thread || typeof thread !== 'object') return '';
  const parts = [];
  if (thread.from) parts.push(`From: ${thread.from}`);
  if (thread.subject) parts.push(`Subject: ${thread.subject}`);
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (message.body) parts.push(String(message.body));
  }
  return parts.join('\n\n');
}

export function createTriage({ llm, tools } = {}) {
  return createAgent({
    id: 'triage',
    name: 'Triage Analyst',
    permissions: AGENT_PERMISSIONS.triage,
    async handler(ctx) {
      const { caseObj } = ctx;
      const text = threadToText(caseObj.thread);

      record(caseObj, 'triage', 'triage.analyze', {
        subject: (caseObj.thread && caseObj.thread.subject) || '',
        messages: Array.isArray(caseObj.thread && caseObj.thread.messages)
          ? caseObj.thread.messages.length
          : 0,
      });

      const raw = await llm.complete({
        system:
          'You are a CAST AI support triage specialist. Triage the customer ' +
          'support thread and return the TriageResult as JSON only.',
        prompt: `Triage this customer support thread and return JSON:\n\n${text}`,
        json: true,
      });

      const triage = normalizeTriageResult(jsonOnly(raw));
      caseObj.triage = triage;

      record(caseObj, 'triage', 'triage.result', {
        category: triage.category,
        provider: triage.provider,
        platform: triage.platform,
        castaiMode: triage.castaiMode,
        severity: triage.severity,
        missingInfo: triage.missingInfo,
      });

      // Short structured result for the orchestrator trace/summary.
      return {
        category: triage.category,
        provider: triage.provider,
        platform: triage.platform,
        severity: triage.severity,
        customerName: triage.customerName,
      };
    },
  });
}
