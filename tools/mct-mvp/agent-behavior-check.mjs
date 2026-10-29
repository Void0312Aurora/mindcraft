// Live check against the survival server (25587, RCON 25576); requires the server running.
// Live check for the agent-behavior fixes against the survival server:
// 1) getEnclosure reports open sides and roof honestly,
// 2) crafting errors list interchangeable recipes,
// 3) a missing torch says how to make one (coal or charcoal).
// Uses Mindcraft's own initBot so mcdata is initialized the normal way.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url)); process.chdir(root);
const imp = p => import(pathToFileURL(join(root, p)).href);
const settings = (await imp('src/agent/settings.js')).default;
Object.assign(settings, { host: '127.0.0.1', port: 25587, minecraft_version: '1.20.1', auth: 'offline' });
const mc = await imp('src/utils/mcdata.js');
const world = await imp('src/agent/library/world.js');
const skills = await imp('src/agent/library/skills.js');
const { RconClient } = await imp('tools/mct-mvp/rcon-client.mjs');
const { preparePad, releasePad } = await imp('tools/mct-mvp/test-pad.mjs');

const bot = mc.initBot('MCT_Check');
bot.output = '';
bot.modes = { isOn: () => false, pause() {}, unpause() {} };
const logs = () => { const o = bot.output; bot.output = ''; return o; };
const rcon = new RconClient({ password: 'mct-observability', port: 25576 });
await new Promise((res, rej) => { bot.once('spawn', res); bot.once('kicked', rej); bot.once('error', rej); });
await rcon.connect();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
try {
  // Build a test cell in the sky so terrain does not interfere.
  const cmd = c => rcon.command(c);
  await cmd('gamemode survival MCT_Check');
  await preparePad(rcon);
  await cmd('tp MCT_Check 202.5 151 202.5');
  await sleep(1500);

  let e = world.getEnclosure(bot);
  assert.equal(e.enclosed, false); assert.equal(e.roof, false); assert.equal(e.open.length, 8);
  results.push(['open platform', JSON.stringify(e)]);

  // 3x3x2 has no interior for `fill hollow`; place the 8 side blocks explicitly
  for (const [x, z] of [[201, 202], [203, 202], [202, 201], [202, 203]])
    for (const y of [151, 152]) await cmd(`setblock ${x} ${y} ${z} stone`);
  await sleep(800);
  e = world.getEnclosure(bot);
  assert.equal(e.open.length, 0, 'all 8 sides should be solid'); assert.equal(e.roof, false);
  results.push(['walls, no roof', JSON.stringify(e)]);

  await cmd('setblock 202 153 202 stone');
  await cmd('setblock 203 152 202 air');                  // east head gap
  await sleep(800);
  e = world.getEnclosure(bot);
  assert.deepEqual(e.open, ['east head']); assert.equal(e.roof, true); assert.equal(e.enclosed, false);
  results.push(['one gap', JSON.stringify(e)]);

  await cmd('setblock 203 152 202 stone');
  await sleep(800);
  e = world.getEnclosure(bot);
  assert.equal(e.enclosed, true);
  const surround = world.getSurroundingBlocks(bot).join(' | ');
  assert.match(surround, /fully enclosed/);
  results.push(['sealed', surround]);

  // Recipe and torch messages
  await cmd('clear MCT_Check');
  await cmd('give MCT_Check spruce_log 2');
  await sleep(600);
  logs();
  await skills.craftRecipe(bot, 'crafting_table', 1);
  const craftMsg = logs();
  assert.match(craftMsg, /spruce_planks: 4/); assert.match(craftMsg, /any one of/);
  results.push(['craft error', craftMsg.trim()]);

  await skills.placeBlock(bot, 'torch', 202, 151, 202);
  const torchMsg = logs();
  assert.match(torchMsg, /charcoal/); assert.match(torchMsg, /smelting any log/);
  results.push(['torch error', torchMsg.trim()]);
} finally {
  await releasePad(rcon);
  rcon.close(); bot.quit();
}
for (const [name, value] of results) console.log(`PASS ${name}: ${value}`);
setTimeout(() => process.exit(0), 300);
