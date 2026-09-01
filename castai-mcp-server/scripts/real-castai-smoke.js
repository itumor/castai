#!/usr/bin/env node
// Real CAST AI API smoke test.
//
// Loads credentials from the repo-root .env file (which is gitignored),
// calls the live CAST AI API, and writes a redacted report to
// .kimchi/docs/castai-mcp-smoke-report.md.
//
// This script never prints the API key or full response bodies.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CastaiClient, CastaiApiError } from '../src/castai-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REPORT_PATH = resolve(ROOT, '..', '.kimchi', 'docs', 'castai-mcp-smoke-report.md');

function loadEnv(path) {
  const env = {};
  if (!existsSync(path)) return env;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function redact(text) {
  if (text == null) return text;
  let s = String(text);
  s = s.replace(/Token\s+[A-Za-z0-9._\-\[\]]+/g, 'Token [REDACTED]');
  s = s.replace(/castai_v1_[A-Za-z0-9._\-\[\]]+/g, 'castai_v1_[REDACTED]');
  s = s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[UUID]');
  return s;
}

async function main() {
  const envPath = resolve(ROOT, '.env');
  const env = loadEnv(envPath);

  const apiKey = env.CASTAI_API_KEY;
  const apiBase = env.CASTAI_API_BASE || 'https://api.eu.cast.ai';
  const orgId = env.CASTAI_ORG_ID || null;

  const report = {
    timestamp: new Date().toISOString(),
    envFile: envPath,
    envFileExists: existsSync(envPath),
    apiBase,
    hasApiKey: Boolean(apiKey && apiKey.length > 0),
    hasOrgId: Boolean(orgId && orgId.length > 0),
    orgId: orgId ? '[REDACTED]' : null,
    testEndpoint: '/v1/kubernetes/external-clusters',
    outcome: 'UNKNOWN',
    statusCode: null,
    clusterCount: null,
    error: null,
    note: null
  };

  if (!report.hasApiKey) {
    report.outcome = 'SKIPPED';
    report.note = 'CASTAI_API_KEY is not set in .env; live smoke test skipped.';
    writeReport(report);
    console.log('SKIPPED: CASTAI_API_KEY not found in .env');
    process.exit(0);
  }

  const client = new CastaiClient({ apiKey, baseUrl: apiBase, orgId });

  try {
    const data = await client.get('/v1/kubernetes/external-clusters');
    report.outcome = 'SUCCESS';
    report.statusCode = 200;
    const items = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : [];
    report.clusterCount = items.length;
    report.note = `Live API call succeeded. Listed ${items.length} cluster(s). Response body redacted in report.`;
  } catch (err) {
    report.outcome = 'FAILURE';
    if (err instanceof CastaiApiError) {
      report.statusCode = err.status;
      report.error = redact(err.message);
    } else {
      report.error = redact(err && err.message ? err.message : String(err));
    }
    report.note = 'Live API call failed. See error for details.';
  }

  writeReport(report);
  console.log(`Smoke test result: ${report.outcome}`);
  if (report.error) {
    console.log(`Error: ${report.error}`);
  }
}

function writeReport(report) {
  const lines = [
    '# CAST AI MCP Server — Real API Smoke Test Report',
    '',
    `- **Generated:** ${report.timestamp}`,
    `- **Outcome:** ${report.outcome}`,
    `- **Env file:** ${report.envFile}`,
    `- **Env file exists:** ${report.envFileExists}`,
    `- **API base:** ${report.apiBase}`,
    `- **Has API key:** ${report.hasApiKey}`,
    `- **Has org ID:** ${report.hasOrgId}`,
    `- **Test endpoint:** ${report.testEndpoint}`,
    `- **Status code:** ${report.statusCode == null ? 'N/A' : report.statusCode}`,
    `- **Cluster count:** ${report.clusterCount == null ? 'N/A' : report.clusterCount}`,
    ''
  ];

  if (report.error) {
    lines.push('## Error', '', '```', redact(report.error), '```', '');
  }

  if (report.note) {
    lines.push('## Note', '', report.note, '');
  }

  lines.push(
    '## Secret handling',
    '',
    'This report redacts API keys, tokens, and UUIDs. The raw response body is not stored.'
  );

  writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
}

main().catch((err) => {
  console.error('Smoke test script failed:', redact(err && err.message ? err.message : String(err)));
  process.exit(1);
});
