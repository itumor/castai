// Brain interface + factory.
//
// A Brain is anything that implements:
//
//   { async complete(messages, opts) → string }
//
//   messages: [{role: 'system'|'user'|'assistant', content: string}]
//   opts:     { json?: boolean, temperature?: number, tag?: string }
//
// Implementations return the completion text as-is. When opts.json is true the
// caller is responsible for parsing the returned string as JSON — brains never
// parse or validate JSON themselves.

import { readFileSync } from 'node:fs';
import { ScriptedBrain } from './scripted-brain.js';

/**
 * Build a Brain from environment-style configuration.
 *
 * env:
 *   SWARM_BRAIN           'scripted' | 'openai' | anything else (error)
 *   SWARM_SCRIPT          path to a JSON script file (for 'scripted')
 *   SWARM_SCRIPT_OBJECT   already-parsed script object (for 'scripted'; takes
 *                         precedence over SWARM_SCRIPT — used by tests)
 *   OPENAI_BASE_URL / OPENAI_API_KEY / SWARM_MODEL   (for 'openai', chunk 4)
 *
 * @param {Record<string, string|undefined>|Record<string, any>} env
 * @returns {Promise<{complete: (messages: Array<{role: string, content: string}>, opts?: {json?: boolean, temperature?: number, tag?: string}) => Promise<string>}>}
 */
export async function createBrain(env = {}) {
  const kind = env.SWARM_BRAIN;

  if (kind === 'scripted') {
    const script = env.SWARM_SCRIPT_OBJECT ?? loadScriptFile(env.SWARM_SCRIPT);
    return new ScriptedBrain(script);
  }

  if (kind === 'openai') {
    let mod;
    try {
      // Lazy import: chunk 4 file may not exist yet. Guarded so the 'scripted'
      // path is never affected by a missing chunk 4.
      mod = await import('./openai-compatible-brain.js');
    } catch (err) {
      throw new Error(
        `SWARM_BRAIN='openai' requires the OpenAICompatibleBrain (chunk 4), ` +
        `but src/brains/openai-compatible-brain.js could not be loaded: ${err.message}. ` +
        `Implement chunk 4 first, or set SWARM_BRAIN='scripted'.`
      );
    }
    return new mod.OpenAICompatibleBrain({
      baseUrl: env.OPENAI_BASE_URL,
      apiKey: env.OPENAI_API_KEY,
      model: env.SWARM_MODEL,
    });
  }

  throw new Error(
    `Unsupported SWARM_BRAIN value: ${JSON.stringify(kind ?? undefined)}. ` +
    `Set SWARM_BRAIN='scripted' with SWARM_SCRIPT=<path to script JSON> ` +
    `(or SWARM_SCRIPT_OBJECT=<parsed object> for tests), or SWARM_BRAIN='openai' ` +
    `with OPENAI_BASE_URL, OPENAI_API_KEY and SWARM_MODEL (chunk 4).`
  );
}

function loadScriptFile(path) {
  if (!path) {
    throw new Error(
      `SWARM_BRAIN='scripted' requires SWARM_SCRIPT (path to a script JSON file) ` +
      `or SWARM_SCRIPT_OBJECT (an already-parsed script object).`
    );
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}
