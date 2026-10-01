// src/agents/index.js — barrel (contract section 8).
//
// ALL_AGENTS: the factored map { agentId -> createX } the orchestrator uses to
// instantiate planned agents. All 13 factories are imported by their contract
// paths; every `create<Name>({ llm, tools })` factory returns
// { id, name, permissions, async run(ctx) } via createAgent from ./base.js.

import { createSupervisor } from './supervisor.js';
import { createTriage } from './triage.js';
import { createResearcher } from './researcher.js';
import { createSre } from './sre.js';
import { createRepro } from './repro.js';
import { createQa } from './qa.js';
import { createProduct } from './product.js';
import { createArchitect } from './architect.js';
import { createSecurity } from './security.js';
import { createVerifier } from './verifier.js';
import { createWriter } from './writer.js';
import { createEscalation } from './escalation.js';
import { createKnowledge } from './knowledge.js';

export const ALL_AGENTS = {
  supervisor: createSupervisor,
  triage: createTriage,
  researcher: createResearcher,
  sre: createSre,
  repro: createRepro,
  qa: createQa,
  product: createProduct,
  architect: createArchitect,
  security: createSecurity,
  verifier: createVerifier,
  writer: createWriter,
  escalation: createEscalation,
  knowledge: createKnowledge,
};
