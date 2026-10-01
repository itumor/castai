import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ScriptedBrain, ScriptedBrainError } from '../../src/brains/scripted-brain.js';
import { createBrain } from '../../src/brains/brain.js';

const msgs = (...m) => m.map(([role, content]) => ({ role, content }));

describe('ScriptedBrain', () => {
  test('tag hit returns scripted response', async () => {
    const brain = new ScriptedBrain({ steps: [{ tag: 'classify', response: '{"ok":true}' }] });
    const out = await brain.complete(msgs(['user', 'hello']), { tag: 'classify' });
    assert.equal(out, '{"ok":true}');
  });

  test('unmatched with no default throws ScriptedBrainError', async () => {
    const brain = new ScriptedBrain({ steps: [{ match: 'nomatch', response: 'x' }] });
    await assert.rejects(
      () => brain.complete(msgs(['user', 'completely unrelated']), {}),
      ScriptedBrainError
    );
  });

  test('exhausted tag steps fall through to match/default', async () => {
    const brain = new ScriptedBrain({
      steps: [
        { tag: 'once', response: 'first' },
        { match: 'refund', response: 'matched' },
      ],
      defaultResponse: 'default',
    });
    assert.equal(await brain.complete(msgs(['user', 'please refund']), { tag: 'once' }), 'first');
    // tag step consumed; falls through to match rule
    assert.equal(await brain.complete(msgs(['user', 'please refund']), { tag: 'once' }), 'matched');
    // no tag, no match → default
    assert.equal(await brain.complete(msgs(['user', 'anything else']), {}), 'default');
  });

  test('match regex is tested against last user message specifically', async () => {
    const brain = new ScriptedBrain({
      steps: [{ match: 'deploy failed', response: 'troubleshooting' }],
    });
    // 'deploy failed' appears in a system and an assistant message but NOT in
    // the last user message → no rule matches and there is no default, so the
    // call must reject with ScriptedBrainError (spec §3 contract).
    await assert.rejects(
      () => brain.complete(
        msgs(
          ['system', 'deploy failed notes'],
          ['user', 'cluster question'],
          ['assistant', 'the deploy failed log shows'],
          ['user', 'actually nevermind']
        )
      ),
      ScriptedBrainError
    );
    // matched nothing above (no rule hit), so it would throw — instead assert that when the
    // last USER message DOES contain the phrase, it matches even though assistant also had it.
    const brain2 = new ScriptedBrain({
      steps: [{ match: 'deploy failed', response: 'troubleshooting' }],
    });
    const out2 = await brain2.complete(
      msgs(
        ['system', 'cluster question'],
        ['user', 'our deploy failed yesterday'],
        ['assistant', 'noted: deploy failed'],
        ['user', 'please help with the deploy failed pod']
      )
    );
    assert.equal(out2, 'troubleshooting');
    // and the first call must NOT have matched (no default → throws)
    await assert.rejects(() => brain.complete([]), ScriptedBrainError);
  });

  test('tag steps are consumed once — second call with same tag falls through', async () => {
    const brain = new ScriptedBrain({
      steps: [{ tag: 'same', response: 'first' }],
      defaultResponse: 'fallback',
    });
    assert.equal(await brain.complete(msgs(['user', 'hi']), { tag: 'same' }), 'first');
    assert.equal(await brain.complete(msgs(['user', 'hi']), { tag: 'same' }), 'fallback');
  });

  test('match steps are reusable', async () => {
    const brain = new ScriptedBrain({ steps: [{ match: /ping/, response: 'pong' }] });
    assert.equal(await brain.complete(msgs(['user', 'ping'])), 'pong');
    assert.equal(await brain.complete(msgs(['user', 'another ping'])), 'pong');
  });
});

describe('createBrain', () => {
  test("createBrain('scripted') via SWARM_SCRIPT_OBJECT works", async () => {
    const brain = await createBrain({
      SWARM_BRAIN: 'scripted',
      SWARM_SCRIPT_OBJECT: { defaultResponse: 'scripted-default' },
    });
    assert.equal(await brain.complete(msgs(['user', 'anything'])), 'scripted-default');
  });

  test('createBrain with unknown SWARM_BRAIN throws with guidance', async () => {
    // Guidance must name both supported brain kinds; exact wording may vary.
    await assert.rejects(
      () => createBrain({ SWARM_BRAIN: 'yolo' }),
      /SWARM_BRAIN='scripted'[\s\S]*SWARM_BRAIN='openai'/
    );
    await assert.rejects(() => createBrain({}), /SWARM_BRAIN/);
  });

  test("createBrain('openai') when chunk 4 file missing gives clear chunk-4 error", async () => {
    // chunk 4 (openai-compatible-brain.js) intentionally not implemented yet here;
    // if it exists, the import succeeds and this test just constructs the brain.
    try {
      const brain = await createBrain({
        SWARM_BRAIN: 'openai',
        OPENAI_BASE_URL: 'http://localhost:1',
        OPENAI_API_KEY: 'k',
        SWARM_MODEL: 'm',
      });
      assert.ok(typeof brain.complete === 'function');
    } catch (err) {
      assert.match(err.message, /chunk 4/);
    }
  });

  test("createBrain('scripted') without SWARM_SCRIPT or SWARM_SCRIPT_OBJECT throws with guidance", async () => {
    await assert.rejects(() => createBrain({ SWARM_BRAIN: 'scripted' }), /SWARM_SCRIPT/);
  });
});
