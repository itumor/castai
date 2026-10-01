// src/tools/castai.js — read-only CAST AI API client (contract section 6).
//
// Safety (root AGENTS.md): read-only posture. This client exposes ONLY get();
// it never issues non-GET HTTP, never logs the API key, and redacts every
// response body before it leaves this module. Two layers of defence:
//   1. The base URL host must be a real cast.ai host.
//   2. Every path must be free of traversal and match the policy allow-list.

import { PolicyError, assertCastaiReadPath, redact } from '../core/policy.js';

const DEFAULT_BASE_URL = 'https://api.eu.cast.ai'; // AGENTS.md default for this repo

/**
 * assertCastaiBaseUrl(baseUrl) — throws unless the URL parses and its host
 * is `cast.ai` or a subdomain of it (strict host check: rejects lookalikes
 * such as `notcast.ai` and `evil.example.com`).
 */
function assertCastaiBaseUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`createCastaiClient: invalid base URL: ${baseUrl}`);
  }
  const host = url.hostname;
  if (host !== 'cast.ai' && !host.endsWith('.cast.ai')) {
    throw new Error(`createCastaiClient: base URL host must end with cast.ai: ${host}`);
  }
}

/**
 * assertNoTraversal(path) — throws PolicyError when the path (raw or
 * percent-decoded) contains a `..` segment. The pattern allow-list matches
 * prefixes, so traversal must be rejected separately.
 */
function assertNoTraversal(path) {
  if (typeof path !== 'string') {
    throw new PolicyError(`CAST AI path must be a string: ${path}`);
  }
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = path;
  }
  for (const variant of [path, decoded]) {
    if (variant.split('/').some((segment) => segment === '..')) {
      throw new PolicyError(`CAST AI path traversal is not allowed: ${path}`);
    }
  }
}

/**
 * createCastaiClient({ apiKey, baseUrl, fetchImpl = fetch })
 * baseUrl default env.CASTAI_API_BASE || 'https://api.eu.cast.ai';
 * throws if the URL host does not end with 'cast.ai'.
 * Returns { get(path) } — ONLY get exists. get asserts the read-only
 * allow-list, throws on non-OK with a `status` property, and returns the
 * redacted JSON body. The API key is never logged.
 */
export function createCastaiClient({ apiKey, baseUrl, fetchImpl = fetch } = {}) {
  const resolvedBaseUrl = (baseUrl || process.env.CASTAI_API_BASE || DEFAULT_BASE_URL).replace(/\/+$/, '');
  assertCastaiBaseUrl(resolvedBaseUrl);

  return {
    async get(path) {
      assertNoTraversal(path);
      assertCastaiReadPath(path);
      const res = await fetchImpl(resolvedBaseUrl + path, {
        headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
      });
      if (!res.ok) {
        const err = new Error(`CAST AI GET ${path} failed: HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return redact(await res.json());
    },
  };
}
