/**
 * K8sClient adapter interface (read-only Kubernetes inspection).
 *
 * @interface K8sClient
 * @description All methods are async and resolve with plain JSON-friendly data.
 *
 *   get(kind, opts)             → object   // e.g. get('pod', { namespace, name }) or a list get
 *   describe(kind, name, opts)  → string   // human-readable describe output
 *   logs(selector, opts)        → string[] // log lines for pods matching selector
 *   top(what, opts)             → object   // resource usage, what: 'nodes' | 'pods'
 *   apiResources()              → object[] // discovery: API resource list
 *   apiVersions()               → string[] // discovery: API versions
 *   clusterInfo()               → object   // control-plane endpoint info
 *   version()                   → object   // client/server version info
 *
 * Implementations:
 *   - src/adapters/k8s/mock-k8s-client.js    (fixture-backed, for tests/evals)
 *   - src/adapters/k8s/kubectl-client.js     (whitelist-gated kubectl subprocess)
 */

/**
 * Frozen list of the 8 K8sClient method names. Used by mocks and permission
 * checks so the interface surface stays in sync.
 *
 * @type {string[]}
 */
export const K8S_METHODS = Object.freeze([
  'get',
  'describe',
  'logs',
  'top',
  'apiResources',
  'apiVersions',
  'clusterInfo',
  'version',
]);
