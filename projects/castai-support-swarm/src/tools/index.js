// src/tools/index.js — tool assembly for the orchestrator (contract section 6).
//
// assembleTools({ repoRoot, env, fetchImpl }) -> { kb, castai, kube, lab, email }
// The CAST AI client is only constructed when env.CASTAI_API_KEY is present,
// otherwise castai is null (offline mode).

import { createCastaiClient } from './castai.js';
import { kubectlRead, parseKubejson } from './kube.js';
import { DEFAULT_KB_ROOTS, searchKb } from './kb.js';
import { draftEmail } from './email.js';
import { applyFix, createCluster, findScaleDownBlockers, simulateScaleDown } from './lab.js';

export function assembleTools({ repoRoot, env = process.env, fetchImpl } = {}) {
  const root = repoRoot ?? process.cwd();

  // Bound KB search: callable as kb('query', { roots?, limit? }) or
  // kb({ query, roots?, limit? }); kb.search is an alias for the same fn.
  const kb = (queryOrOpts, maybeOpts = {}) => {
    const opts =
      typeof queryOrOpts === 'string'
        ? { ...maybeOpts, query: queryOrOpts }
        : { ...(queryOrOpts ?? {}) };
    return searchKb({
      repoRoot: root,
      roots: opts.roots ?? DEFAULT_KB_ROOTS,
      query: opts.query ?? '',
      limit: opts.limit ?? 5,
    });
  };
  kb.search = kb;

  const castai = env?.CASTAI_API_KEY
    ? createCastaiClient({
        apiKey: env.CASTAI_API_KEY,
        baseUrl: env.CASTAI_API_BASE,
        fetchImpl: fetchImpl ?? fetch,
      })
    : null;

  const kube = { kubectlRead, parseKubejson };
  const lab = { createCluster, findScaleDownBlockers, applyFix, simulateScaleDown };
  const email = { draftEmail };

  return { kb, castai, kube, lab, email };
}
