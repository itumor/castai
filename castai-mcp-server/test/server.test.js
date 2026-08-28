// Tests for the MCP server entry point. These exercise the read-only
// enforcement wrapper and the config loader. They need mocha + chai
// (installed via `npm install`) and pull the MCP SDK lazily so the
// module can be loaded without the SDK at all.

import { expect } from 'chai';

import {
  loadConfig,
  createLogger,
  enforceReadOnly,
  buildServer
} from '../src/server.js';

describe('config loader', () => {
  it('uses sensible defaults when env is empty', () => {
    const cfg = loadConfig({});
    expect(cfg.apiKey).to.equal('');
    expect(cfg.apiBase).to.equal('https://api.eu.cast.ai');
    expect(cfg.orgId).to.equal(null);
    expect(cfg.logLevel).to.equal('info');
    expect(cfg.approvalMode).to.equal('block');
  });

  it('reads overrides from the env object', () => {
    const cfg = loadConfig({
      CASTAI_API_KEY: 'k',
      CASTAI_API_BASE: 'https://api.us.cast.ai',
      CASTAI_ORG_ID: 'org',
      LOG_LEVEL: 'debug',
      APPROVAL_MODE: 'approve'
    });
    expect(cfg.apiKey).to.equal('k');
    expect(cfg.apiBase).to.equal('https://api.us.cast.ai');
    expect(cfg.orgId).to.equal('org');
    expect(cfg.logLevel).to.equal('debug');
    expect(cfg.approvalMode).to.equal('approve');
  });

  it('lowercases log level and approval mode', () => {
    const cfg = loadConfig({ LOG_LEVEL: 'DEBUG', APPROVAL_MODE: 'BLOCK' });
    expect(cfg.logLevel).to.equal('debug');
    expect(cfg.approvalMode).to.equal('block');
  });
});

describe('logger', () => {
  it('writes to the provided sink', () => {
    const lines = [];
    const sink = { write: (s) => lines.push(s) };
    const log = createLogger('debug', sink);
    log.info('hello');
    log.warn('world');
    expect(lines.join('')).to.include('[info] hello');
    expect(lines.join('')).to.include('[warn] world');
  });

  it('honours the level threshold', () => {
    const lines = [];
    const sink = { write: (s) => lines.push(s) };
    const log = createLogger('warn', sink);
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    const text = lines.join('');
    expect(text).to.not.include('[debug] d');
    expect(text).to.not.include('[info] i');
    expect(text).to.include('[warn] w');
    expect(text).to.include('[error] e');
  });
});

describe('read-only enforcement', () => {
  function silentLogger() {
    const noop = () => {};
    return { debug: noop, info: noop, warn: noop, error: noop, redact: (s) => s };
  }

  it('passes through when the tool is not mutating', async () => {
    let called = false;
    const handler = async () => {
      called = true;
      return { content: [{ type: 'text', text: 'ok' }] };
    };
    const wrapped = enforceReadOnly(handler, {
      toolName: 'list_clusters',
      mutating: false,
      approvalMode: 'block',
      logger: silentLogger()
    });
    const res = await wrapped({});
    expect(called).to.equal(true);
    expect(res.content[0].text).to.equal('ok');
  });

  it('blocks mutating tools when approval mode is block', async () => {
    const handler = async () => ({ content: [{ type: 'text', text: 'should not run' }] });
    const wrapped = enforceReadOnly(handler, {
      toolName: 'connect_cluster',
      mutating: true,
      approvalMode: 'block',
      logger: silentLogger()
    });
    let caught = null;
    try {
      await wrapped({});
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(Error);
    expect(caught.message).to.match(/write operation/);
    expect(caught.message).to.match(/APPROVAL_MODE=approve/);
  });

  it('allows mutating tools through (with a stub warning) when approval mode is approve', async () => {
    let called = false;
    const handler = async () => {
      called = true;
      return { content: [{ type: 'text', text: 'ok' }] };
    };
    const wrapped = enforceReadOnly(handler, {
      toolName: 'connect_cluster',
      mutating: true,
      approvalMode: 'approve',
      logger: silentLogger()
    });
    const res = await wrapped({});
    expect(called).to.equal(true);
    expect(res.content[0].text).to.equal('ok');
  });
});

describe('server factory', () => {
  it('returns a Server instance and a client factory', async () => {
    const { server, getClient } = buildServer({
      apiKey: 'k',
      apiBase: 'https://api.eu.cast.ai',
      orgId: null,
      logLevel: 'error',
      approvalMode: 'block'
    });
    expect(server).to.exist;
    expect(typeof getClient).to.equal('function');
    // Build a client without performing any I/O.
    const client = getClient();
    expect(client.baseUrl).to.equal('https://api.eu.cast.ai');
  });
});
