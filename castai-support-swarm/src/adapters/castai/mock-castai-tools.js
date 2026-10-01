import { READ_ONLY_TOOL_NAMES, ToolNotAllowedError } from './castai-tools.js';

/**
 * Fixture-backed CastaiTools implementation for tests and evals.
 *
 * - Refuses (throws ToolNotAllowedError) any toolName outside
 *   READ_ONLY_TOOL_NAMES — the guard lives at the interface level, not just
 *   in the real MCP adapter.
 * - Resolves fixtures[toolName] when present:
 *     - value      → returned as-is
 *     - function   → called with the call's `args`, its return value returned
 * - Falls back to a sensible empty default ([] for `list_*` tools, {} otherwise).
 * - Records every successful call into `this.calls`
 *   ([{ toolName, args, result }]) for assertions.
 *
 * @implements {import('./castai-tools.js').CastaiTools}
 */
export class MockCastaiTools {
  /**
   * @param {Object<string, (object|Function)>} [fixtures] tool name → result value or args → result function
   */
  constructor(fixtures = {}) {
    this.fixtures = fixtures;
    /** @type {{toolName: string, args: object, result: object}[]} */
    this.calls = [];
  }

  /**
   * @param {string} toolName one of READ_ONLY_TOOL_NAMES
   * @param {object} [args]
   * @returns {Promise<object>}
   */
  async call(toolName, args = {}) {
    if (!READ_ONLY_TOOL_NAMES.includes(toolName)) {
      throw new ToolNotAllowedError(toolName);
    }
    const fixture = this.fixtures[toolName];
    const result =
      typeof fixture === 'function' ? fixture(args) : fixture !== undefined ? fixture : emptyDefault(toolName);
    const entry = { toolName, args, result };
    this.calls.push(entry);
    return result;
  }
}

/**
 * Sensible empty default for a read-only tool with no fixture.
 *
 * @param {string} toolName
 * @returns {object}
 */
function emptyDefault(toolName) {
  if (toolName.startsWith('list_')) return [];
  return {};
}
