import { K8S_METHODS } from './k8s-client.js';

/**
 * Sensible empty default per K8sClient method.
 *
 * @param {string} method
 * @returns {*}
 */
function emptyDefault(method) {
  switch (method) {
    case 'describe':
      return '';
    case 'logs':
    case 'apiResources':
    case 'apiVersions':
      return [];
    default:
      return {};
  }
}

/**
 * Fixture-backed K8sClient implementation for tests and evals.
 *
 * - Fixtures are keyed by method name (see K8S_METHODS).
 * - A fixture may be a value (returned as-is) or a function (called with the
 *   method's arguments, its return value returned).
 * - Methods without a fixture resolve to a sensible empty default.
 * - Every successful call is recorded into `this.calls`
 *   ([{ method, args, result }]) for assertions.
 *
 * @implements {import('./k8s-client.js').K8sClient}
 */
export class MockK8sClient {
  /**
   * @param {Object<string, (*|Function)>} [fixtures] method name → result value or fn(...args) → result
   */
  constructor(fixtures = {}) {
    this.fixtures = fixtures;
    /** @type {{method: string, args: *[], result: *}[]} */
    this.calls = [];
  }

  /**
   * Shared resolution + recording logic for all 8 interface methods.
   *
   * @private
   * @param {string} method
   * @param {*[]} args
   * @returns {Promise<*>}
   */
  async _call(method, args) {
    const fixture = this.fixtures[method];
    const result =
      typeof fixture === 'function' ? fixture(...args) : fixture !== undefined ? fixture : emptyDefault(method);
    const entry = { method, args, result };
    this.calls.push(entry);
    return result;
  }

  /** @returns {Promise<object>} */
  get(kind, opts) {
    return this._call('get', [kind, opts]);
  }

  /** @returns {Promise<string>} */
  describe(kind, name, opts) {
    return this._call('describe', [kind, name, opts]);
  }

  /** @returns {Promise<string[]>} */
  logs(selector, opts) {
    return this._call('logs', [selector, opts]);
  }

  /** @returns {Promise<object>} */
  top(what, opts) {
    return this._call('top', [what, opts]);
  }

  /** @returns {Promise<object[]>} */
  apiResources() {
    return this._call('apiResources', []);
  }

  /** @returns {Promise<string[]>} */
  apiVersions() {
    return this._call('apiVersions', []);
  }

  /** @returns {Promise<object>} */
  clusterInfo() {
    return this._call('clusterInfo', []);
  }

  /** @returns {Promise<object>} */
  version() {
    return this._call('version', []);
  }
}
