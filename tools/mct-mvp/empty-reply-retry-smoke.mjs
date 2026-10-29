import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url)); process.chdir(root);
const { Prompter } = await import(pathToFileURL(join(root, 'src/models/prompter.js')).href);
// Minimal stand-in: only what promptConvo touches.
function fake(replies) {
  const p = Object.create(Prompter.prototype);
  let calls = 0;
  Object.assign(p, {
    agent: { name: 'T', task: {} }, profile: { conversing: 'x' }, convo_examples: null, cooldown: 0, last_prompt_time: 0,
    chat_model: { sendRequest: async () => replies[Math.min(calls++, replies.length - 1)] },
    checkCooldown: async () => {}, replaceStrings: async s => s, _saveLog: async () => {},
  });
  return { p, calls: () => calls };
}
let f = fake(['', '!stats']); assert.equal(await f.p.promptConvo([]), '!stats'); assert.equal(f.calls(), 2, 'empty reply retried once');
f = fake(['', '']); assert.equal(await f.p.promptConvo([]), ''); assert.equal(f.calls(), 2, 'only one retry');
f = fake(['\t']); assert.equal(await f.p.promptConvo([]), '\t'); assert.equal(f.calls(), 1, 'deliberate tab kept, no retry');
f = fake(['ok']); assert.equal(await f.p.promptConvo([]), 'ok'); assert.equal(f.calls(), 1);
console.log('retry tests: PASS');
