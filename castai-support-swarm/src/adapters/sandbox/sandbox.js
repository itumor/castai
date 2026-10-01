/**
 * Sandbox adapter interface (deterministic reproduction harness).
 *
 * @interface Sandbox
 * @description A sandbox replays a named failure scenario and reports whether
 * it reproduces, under exactly one async method:
 *
 *   run(scenario) → Promise<{
 *     reproduced: boolean,
 *     triggerConditions: string[],
 *     before: string,
 *     after: string,
 *     logs: string[]
 *   }>
 *
 * `scenario` is either a scenario id string or an object { id, params }.
 * Results must be deterministic for a given (id, params) pair so replays can
 * be compared for equality.
 *
 * Implementations:
 *   - src/adapters/sandbox/simulated-sandbox.js (registry-backed, deterministic)
 *   - src/adapters/sandbox/eks-live-sandbox.js  (allowlist-gated live replay)
 */
