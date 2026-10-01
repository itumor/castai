// ScriptedBrain — deterministic brain for tests and evals.
//
// Script shape:
//   {
//     steps: [ {tag, response} | {match, response} ],
//     defaultResponse: string (optional)
//   }
//
// Resolution order per complete() call:
//   1. exact opts.tag step  — {tag} steps are CONSUMED ONCE (popped from the
//      queue on use); a second call with the same tag falls through to the
//      remaining rules.
//   2. first {match} step whose regex tests the LAST USER message — {match}
//      steps are REUSABLE (they stay in the script and can fire repeatedly).
//      Only the last message with role 'user' is tested; system/assistant
//      messages are ignored.
//   3. defaultResponse, if present.
//   4. otherwise throw ScriptedBrainError — forces test authors to be explicit.
//
// ScriptedBrain returns scripted strings as-is; callers parse JSON themselves.

export class ScriptedBrainError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScriptedBrainError';
  }
}

export class ScriptedBrain {
  /**
   * @param {{steps?: Array<{tag?: string, match?: string|RegExp, response: string}>, defaultResponse?: string}} script
   */
  constructor(script) {
    if (!script || typeof script !== 'object') {
      throw new TypeError('ScriptedBrain requires a script object: {steps: [...], defaultResponse?}');
    }
    this.steps = [...(script.steps ?? [])];
    this.defaultResponse = script.defaultResponse;
  }

  /**
   * @param {Array<{role: string, content: string}>} messages
   * @param {{json?: boolean, temperature?: number, tag?: string}} [opts]
   * @returns {Promise<string>}
   */
  async complete(messages, opts = {}) {
    // 1. Exact tag step — consumed once (popped).
    if (opts.tag !== undefined) {
      const idx = this.steps.findIndex((s) => s.tag === opts.tag);
      if (idx !== -1) {
        const [step] = this.steps.splice(idx, 1);
        return step.response;
      }
    }

    // 2. First match step whose regex tests the LAST USER message (reusable).
    const lastUser = lastUserMessage(messages);
    if (lastUser !== null) {
      for (const step of this.steps) {
        if (step.match !== undefined && step.tag === undefined) {
          const re = step.match instanceof RegExp ? step.match : new RegExp(step.match);
          if (re.test(lastUser)) return step.response;
        }
      }
    }

    // 3. Default response.
    if (this.defaultResponse !== undefined) return this.defaultResponse;

    // 4. Nothing matched — be explicit.
    throw new ScriptedBrainError(
      `ScriptedBrain: no rule matched (tag=${JSON.stringify(opts.tag)}, ` +
      `lastUser=${JSON.stringify(lastUser)}) and no defaultResponse is configured. ` +
      `Add a {tag}/{match} step or a defaultResponse to the script.`
    );
  }
}

function lastUserMessage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return messages[i]?.content ?? null;
  }
  return null;
}
