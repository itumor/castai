// Secret redaction utilities.
//
// Pattern family ported verbatim-in-behavior (pattern copy, not an import)
// from castai-mcp-server/src/tools/index.js (`redactErrorMessage`,
// `redactJsonStringValues`, `SENSITIVE_KEYS`) and
// castai-mcp-server/src/castai-client.js (`scrubValue`).

// Sensitive key names whose string values must be masked in JSON-ish
// payloads. Comparison is case-insensitive.
const SENSITIVE_KEYS = new Set([
  'apikey',
  'api_key',
  'api-key',
  'token',
  'accesstoken',
  'access_token',
  'access-token',
  'authtoken',
  'auth_token',
  'auth-token',
  'password',
  'secret',
  'clientsecret',
  'client_secret',
  'client-secret'
]);

// Recursive scrubber: walks objects/arrays, masks string values of
// sensitive keys, and re-parses JSON-shaped strings so nested secrets
// inside string payloads are masked too. Non-string leaves untouched.
export function redactDeep(value) {
  if (typeof value === 'string') {
    // Try to parse the string as JSON; if it is a JSON object, walk
    // its keys and mask sensitive values.
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return JSON.stringify(redactDeep(parsed));
      } catch (_) {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(String(k).toLowerCase()) && typeof v === 'string') {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactDeep(v);
      }
    }
    return out;
  }
  return value;
}

// String redaction: masks credential-shaped substrings (Authorization
// headers, API keys, CAST AI key literals, api_key= params) and then
// masks JSON-shaped secrets embedded inside the message body.
export function redact(text) {
  if (text == null) return text;
  let s = String(text);
  s = s.replace(/Authorization:\s*Token\s+[A-Za-z0-9._\-\[\]]+/gi, 'Authorization: Token [REDACTED]');
  s = s.replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._\-\[\]]+/gi, 'Authorization: Bearer [REDACTED]');
  s = s.replace(/X-API-Key[\s:]+[A-Za-z0-9._\-\[\]]+/gi, 'X-API-Key: [REDACTED]');
  s = s.replace(/Token\s+[A-Za-z0-9._\-\[\]]+/g, 'Token [REDACTED]');
  s = s.replace(/Bearer\s+[A-Za-z0-9._\-\[\]]+/g, 'Bearer [REDACTED]');
  s = s.replace(/castai_v1_[A-Za-z0-9._\-\[\]]+/g, 'castai_v1_[REDACTED]');
  s = s.replace(/\bapi[_-]?key[\s]*[=:][\s]*[A-Za-z0-9._\-\[\]]+/gi, 'api_key=[REDACTED]');
  const walked = redactDeep(s);
  if (typeof walked === 'string') return walked;
  try {
    return JSON.stringify(walked);
  } catch (_) {
    return s;
  }
}
