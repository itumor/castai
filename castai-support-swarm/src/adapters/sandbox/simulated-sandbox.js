/**
 * Deep-freeze a value in place (recursively for plain objects and arrays).
 *
 * @param {*} value
 * @param {WeakSet<object>} [seen]
 * @returns {*}
 */
function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

/**
 * Default result for a scenario id that is not in the registry.
 *
 * @returns {{reproduced: boolean, triggerConditions: string[], before: string, after: string, logs: string[]}}
 */
function unknownScenarioResult() {
  return {
    reproduced: false,
    triggerConditions: [],
    before: 'unknown scenario',
    after: 'no change',
    logs: [],
  };
}

/**
 * Registry-backed Sandbox implementation that replays scenarios
 * deterministically. Resolved results are deep-frozen, so callers cannot
 * mutate them and repeat runs deep-equal each other exactly.
 *
 * @implements {import('./sandbox.js').Sandbox}
 */
export class SimulatedSandbox {
  /**
   * @param {Object<string, (object|Function)>} [scenarios] scenario id → result object or fn(params) → result
   */
  constructor(scenarios = {}) {
    this.scenarios = scenarios;
  }

  /**
   * @param {string|{id: string, params?: object}} scenario
   * @returns {Promise<{reproduced: boolean, triggerConditions: string[], before: string, after: string, logs: string[]}>}
   */
  async run(scenario) {
    const id = typeof scenario === 'string' ? scenario : scenario?.id;
    const params = typeof scenario === 'object' && scenario !== null ? (scenario.params ?? {}) : {};

    const entry = this.scenarios[id];
    let result;
    if (entry === undefined) {
      result = unknownScenarioResult();
    } else if (typeof entry === 'function') {
      result = await entry(params);
    } else {
      result = entry;
    }

    // Fresh structured copy per run: identical on repeat, immune to caller
    // mutation of either the registry or a previously returned result.
    return deepFreeze(structuredClone(result));
  }
}
