'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const HOME = os.homedir();
const ZSHRC = path.join(HOME, '.zshrc');
const CMUX_JSON = path.join(HOME, '.config', 'cmux', 'cmux.json');
const PING_AIFF = '/System/Library/Sounds/Ping.aiff';

/**
 * Strip `//` line comments from JSONC content before parsing.
 *
 * Walks the input character-by-character, tracking whether we are inside a
 * double-quoted string (the only string syntax used in the cmux config). When
 * inside a string, characters are passed through verbatim, so embedded `//`
 * substrings (e.g. the `https://` in the `$schema` URL) are preserved. When
 * outside a string, a `//` starts a line comment that runs to the next `\n`.
 *
 * Escaped quotes inside strings (`\"`) are handled so they do not terminate
 * the string early.
 */
function stripJsoncComments(input) {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < input.length) {
    const ch = input[i];
    const next = i + 1 < input.length ? input[i + 1] : '';
    if (inString) {
      out += ch;
      if (ch === '\\' && next !== '') {
        // Pass escaped char through and skip it.
        out += next;
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }
    // Outside a string.
    if (ch === '"') {
      out += ch;
      inString = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      // Skip until newline (but keep the newline in the output).
      while (i < input.length && input[i] !== '\n') {
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Remove trailing commas from JSON/JSONC content. JSONC (per the VSCode spec
 * used by cmux) permits a trailing comma after the last element of an array
 * or object. After comment stripping, the cmux.json file exposes trailing
 * commas that were previously hidden inside `//` comments.
 *
 * Only commas followed by whitespace (including newlines) and then `]` or `}`
 * are removed. The pass is idempotent and safe to run on already-stripped text.
 */
function stripTrailingCommas(input) {
  // Match a comma, then any run of whitespace (incl. newlines), then a closing
  // bracket or brace, and remove the comma. Use a global replacement.
  return input.replace(/,(\s*[\]}])/g, '$1');
}

/**
 * Parse cmux.json (JSONC) into a JS object.
 */
function readCmuxConfig(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const noComments = stripJsoncComments(raw);
  const noTrailingCommas = stripTrailingCommas(noComments);
  return JSON.parse(noTrailingCommas);
}

/**
 * Check whether zshrc contains a top-level shell function definition with the
 * given name. A function definition looks like:  name() { ... }
 * Returns the matched body (between the braces) or null if not found.
 */
function findShellFunction(zshrcContent, name) {
  // Match the function header: `<name>() {` possibly with leading whitespace.
  // Word-boundaries avoid matching e.g. `notify_thing()` when looking for `notify`.
  const headerRe = new RegExp('^\\s*' + name + '\\s*\\(\\s*\\)\\s*\\{', 'm');
  const match = headerRe.exec(zshrcContent);
  if (!match) return null;

  const start = match.index + match[0].length;
  let depth = 1;
  let i = start;
  while (i < zshrcContent.length && depth > 0) {
    const ch = zshrcContent[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    i += 1;
  }
  if (depth !== 0) return null;
  // Body is between the opening `{` (at start) and the matching `}`.
  return zshrcContent.slice(start, i - 1);
}

test('~/.zshrc contains a kimchi() shell function that wraps the real kimchi binary', () => {
  assert.ok(fs.existsSync(ZSHRC), `expected ${ZSHRC} to exist`);
  const content = fs.readFileSync(ZSHRC, 'utf8');

  const body = findShellFunction(content, 'kimchi');
  assert.ok(body !== null, 'expected ~/.zshrc to define kimchi() { ... }');

  // `command kimchi` is the standard zsh idiom that bypasses a function of the
  // same name and invokes the real binary on $PATH. The wrapper must call it
  // (with any args forwarded) so the function shadows the binary but still
  // delegates to it.
  assert.match(
    body,
    /command\s+kimchi\b/,
    'expected kimchi() body to call `command kimchi` so it wraps the real binary'
  );
});

test('~/.zshrc contains a notify() shell function', () => {
  assert.ok(fs.existsSync(ZSHRC), `expected ${ZSHRC} to exist`);
  const content = fs.readFileSync(ZSHRC, 'utf8');

  const body = findShellFunction(content, 'notify');
  assert.ok(body !== null, 'expected ~/.zshrc to define notify() { ... }');
});

test('~/.config/cmux/cmux.json exists and is valid JSONC', () => {
  assert.ok(fs.existsSync(CMUX_JSON), `expected ${CMUX_JSON} to exist`);

  const raw = fs.readFileSync(CMUX_JSON, 'utf8');
  // Sanity: the file actually contains // comments, so plain JSON.parse would fail.
  assert.match(raw, /\/\//, 'expected cmux.json to contain // comments (JSONC)');

  // Stripping // comments (and trailing commas that were hidden inside them)
  // must yield parseable JSON.
  const stripped = stripJsoncComments(raw);
  const normalized = stripTrailingCommas(stripped);
  let parsed;
  assert.doesNotThrow(
    () => {
      parsed = JSON.parse(normalized);
    },
    'expected cmux.json to be valid JSONC (parseable after stripping // comments and JSONC trailing commas)'
  );

  assert.strictEqual(typeof parsed, 'object', 'expected parsed JSON to be an object');
  assert.notStrictEqual(parsed, null, 'expected parsed JSON to be a non-null object');
});

test('cmux.json has a top-level notifications object with a customSoundFilePath pointing to an existing file', () => {
  const config = readCmuxConfig(CMUX_JSON);

  assert.ok(
    Object.prototype.hasOwnProperty.call(config, 'notifications'),
    'expected top-level `notifications` key in cmux.json'
  );
  assert.strictEqual(
    typeof config.notifications,
    'object',
    'expected notifications to be an object'
  );
  assert.notStrictEqual(config.notifications, null, 'expected notifications to be non-null');

  const soundPath = config.notifications.customSoundFilePath;
  assert.ok(
    typeof soundPath === 'string' && soundPath.length > 0,
    'expected notifications.customSoundFilePath to be a non-empty string'
  );

  // Expand a leading ~ to $HOME so paths like ~/Library/Sounds/foo.wav work.
  const resolved = soundPath.startsWith('~')
    ? path.join(HOME, soundPath.slice(1))
    : soundPath;

  assert.ok(fs.existsSync(resolved), `expected custom sound file to exist: ${resolved}`);
});

test('cmux.json sets notifications.unreadPaneRing=true and notifications.paneFlash=true', () => {
  const config = readCmuxConfig(CMUX_JSON);
  const notif = config.notifications;
  assert.ok(notif, 'expected notifications object');

  assert.strictEqual(
    notif.unreadPaneRing,
    true,
    'expected notifications.unreadPaneRing to be true'
  );
  assert.strictEqual(
    notif.paneFlash,
    true,
    'expected notifications.paneFlash to be true'
  );
});

test('/System/Library/Sounds/Ping.aiff exists and is readable', () => {
  assert.ok(fs.existsSync(PING_AIFF), `expected ${PING_AIFF} to exist`);

  let stat;
  assert.doesNotThrow(
    () => {
      stat = fs.statSync(PING_AIFF);
    },
    `expected ${PING_AIFF} to be stat-able`
  );
  assert.ok(stat.isFile(), `expected ${PING_AIFF} to be a regular file`);

  // Read a single byte to prove the file is readable; this does NOT play any sound.
  const fd = fs.openSync(PING_AIFF, 'r');
  try {
    const buf = Buffer.alloc(1);
    const bytesRead = fs.readSync(fd, buf, 0, 1, 0);
    assert.ok(bytesRead >= 0, `expected to read from ${PING_AIFF}`);
  } finally {
    fs.closeSync(fd);
  }
});

test('custom sound file from cmux.json exists and is readable', () => {
  const config = readCmuxConfig(CMUX_JSON);
  const soundPath = config.notifications.customSoundFilePath;
  assert.ok(
    typeof soundPath === 'string' && soundPath.length > 0,
    'expected customSoundFilePath to be set'
  );

  const resolved = soundPath.startsWith('~')
    ? path.join(HOME, soundPath.slice(1))
    : soundPath;

  assert.ok(fs.existsSync(resolved), `expected custom sound file to exist: ${resolved}`);

  let stat;
  assert.doesNotThrow(
    () => {
      stat = fs.statSync(resolved);
    },
    `expected ${resolved} to be stat-able`
  );
  assert.ok(stat.isFile(), `expected ${resolved} to be a regular file`);

  const fd = fs.openSync(resolved, 'r');
  try {
    const buf = Buffer.alloc(1);
    const bytesRead = fs.readSync(fd, buf, 0, 1, 0);
    assert.ok(bytesRead >= 0, `expected to read from ${resolved}`);
  } finally {
    fs.closeSync(fd);
  }
});

// ---------------------------------------------------------------------------
// Behavioral test: when a user types `kimchi` in zsh, the wrapper function
// defined in ~/.zshrc must invoke `afplay` and `osascript` after the wrapped
// command exits.
//
// We do NOT call the real `kimchi` binary. Instead we build a temp directory
// holding three stub scripts:
//   - kimchi   : exits 0 immediately (no network, no real work)
//   - afplay   : echoes AFPLAY_INVOKED so we can detect invocation
//   - osascript: echoes OSASCRIPT_INVOKED so we can detect invocation
//
// We prepend the temp directory to PATH and invoke `zsh -i -c 'kimchi'`.
// The wrapper uses `command kimchi` to bypass the function lookup, which
// resolves to our fake because it is first in PATH. The wrapper then calls
// `afplay` and `osascript`, both of which our fakes intercept so no sound
// is played and no Notification Center banner is shown.
// ---------------------------------------------------------------------------
test('kimchi() shell function invokes afplay and osascript after the wrapped command exits', () => {
  if (process.platform !== 'darwin') {
    // afplay and osascript are macOS-only. The wrapper itself is platform-
    // specific by design; skip the behavioral check elsewhere.
    return;
  }

  assert.ok(fs.existsSync(ZSHRC), `expected ${ZSHRC} to exist`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimchi-e2e-'));

  // Stub: the "real" kimchi binary the wrapper delegates to. Must exit 0 so
  // the wrapper's `local exit_code=$?` captures a clean exit and the
  // notification code path still runs.
  const fakeKimchi = path.join(tmpDir, 'kimchi');
  fs.writeFileSync(
    fakeKimchi,
    '#!/bin/sh\nexit 0\n',
    { mode: 0o755 }
  );

  // Stub: afplay. Real afplay would play /System/Library/Sounds/Ping.aiff.
  // We echo a sentinel on stdout so we can detect the call without hearing
  // any audio.
  const fakeAfplay = path.join(tmpDir, 'afplay');
  fs.writeFileSync(
    fakeAfplay,
    '#!/bin/sh\necho AFPLAY_INVOKED\n',
    { mode: 0o755 }
  );

  // Stub: osascript. Real osascript would post a Notification Center banner.
  // We echo a sentinel on stdout instead.
  const fakeOsascript = path.join(tmpDir, 'osascript');
  fs.writeFileSync(
    fakeOsascript,
    '#!/bin/sh\necho OSASCRIPT_INVOKED\n',
    { mode: 0o755 }
  );

  // Prepend tmpDir to PATH so all three fakes shadow the real tools.
  // `command kimchi` inside the wrapper does a PATH lookup that bypasses the
  // function table, so the fake must be first in PATH to be selected.
  const env = { ...process.env, PATH: `${tmpDir}${path.delimiter}${process.env.PATH || ''}` };

  let result;
  try {
    result = spawnSync('zsh', ['-i', '-c', 'kimchi'], {
      env,
      encoding: 'utf8',
      timeout: 30_000,
      // Suppress any output to the controlling terminal; we read it back below.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } finally {
    // Best-effort cleanup. rmSync is fine on macOS where the temp dir is local.
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      // Cleanup failures must not mask the real assertions.
    }
  }

  assert.strictEqual(
    result.error,
    undefined,
    `zsh failed to start: ${result.error && result.error.message}`
  );
  assert.strictEqual(
    result.status,
    0,
    `expected zsh to exit 0; status=${result.status}, signal=${result.signal}, ` +
      `stderr=\n${result.stderr}`
  );

  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;

  // The wrapper's first line after running the command is
  //   afplay /System/Library/Sounds/Ping.aiff 2>/dev/null
  // and the second is
  //   osascript -e 'display notification "Kimchi session ended" ...' 2>/dev/null
  // The 2>/dev/null suppresses their stderr but not their stdout, so our
  // stub echoes (on stdout) survive and prove both calls ran.
  assert.match(
    combined,
    /AFPLAY_INVOKED/,
    'expected kimchi() wrapper to invoke afplay after the wrapped command exits; ' +
      `got combined output:\n${combined}`
  );
  assert.match(
    combined,
    /OSASCRIPT_INVOKED/,
    'expected kimchi() wrapper to invoke osascript after the wrapped command exits; ' +
      `got combined output:\n${combined}`
  );
});
