// Live check against the survival server (25587, RCON 25576). Pass "old" to reproduce the pre-fix kill.
// Reproduces the run-08 hang: an action whose pathfinding can't reach its next
// node (bot hops in place under a 1-block ceiling with the goal up a pillar),
// then a mode interrupts it. Before the fix ActionManager.stop() kept calling
// pathfinder.stop(), which only acts at the next node, and the process was
// killed after 10 s. Measures how long stop() now takes and that the
// process survives.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url)); process.chdir(root);
const imp = p => import(pathToFileURL(join(root, p)).href);
const settings = (await imp('src/agent/settings.js')).default;
Object.assign(settings, { host: '127.0.0.1', port: 25587, minecraft_version: '1.20.1', auth: 'offline' });
const mc = await imp('src/utils/mcdata.js');
const skills = await imp('src/agent/library/skills.js');
const { ActionManager } = await imp('src/agent/action_manager.js');
const { RconClient } = await imp('tools/mct-mvp/rcon-client.mjs');
const { preparePad, releasePad } = await imp('tools/mct-mvp/test-pad.mjs');
const bot = mc.initBot('MCT_Check'); bot.output = '';
bot.modes = { isOn: () => false, pause() {}, unpause() {} };
const rcon = new RconClient({ password: 'mct-observability', port: 25576 });
await new Promise(r => bot.once('spawn', r)); await rcon.connect();
const c = x => rcon.command(x); const sleep = ms => new Promise(r => setTimeout(r, ms));
// minimal agent around a real ActionManager
let killed = null;
const agent = {
  bot, name: 'MCT_Check', telemetry: null, _currentDecisionId: null,
  clearBotLogs() { bot.output = ''; bot.interrupt_code = false; },
  requestInterrupt(force = false) { bot.interrupt_code = true; bot.stopDigging(); bot.collectBlock.cancelTask(); bot.pathfinder.stop(); if (force) bot.pathfinder.setGoal(null); bot.pvp.stop(); },
  cleanKill(msg) { killed = msg; },
  isIdle() { return !this.actions.executing; },
  self_prompter: { isActive: () => false },
};
agent.actions = new ActionManager(agent);
try {
  await c('gamemode survival MCT_Check'); await c('clear MCT_Check');
  await preparePad(rcon, 'bedrock');
  // Run-08 situation: pathfinding is active but the bot never arrives at its
  // next node. Freeze the bot's physics so it cannot move toward the node while
  // pathfinding keeps running; this is exactly the state in which
  // pathfinder.stop() (deferred until the next node) never takes effect.
  await c('tp MCT_Check 202.5 151 198.5');
  await sleep(2500);
  // the pad is far from spawn: wait until the bot actually stands on loaded bedrock there
  for (let i = 0; i < 20 && bot.blockAt(bot.entity.position.offset(0, -1, 0))?.name !== 'bedrock'; i++) await sleep(250);
  console.log('ready at', bot.entity.position.floored().toString(), 'standing on', bot.blockAt(bot.entity.position.offset(0, -1, 0))?.name);
  const mode = process.argv[2] || 'fixed';
  if (mode === 'old') agent.requestInterrupt = function () { bot.interrupt_code = true; bot.stopDigging(); bot.collectBlock.cancelTask(); bot.pathfinder.stop(); bot.pvp.stop(); };
  const run = agent.actions.runAction('action:goTo', async () => { await skills.goToPosition(bot, 202, 151, 212, 1); });
  run.then(r => console.log('action result:', JSON.stringify(r).slice(0, 220)), e => console.log('action threw:', e.message));
  // freeze the bot the moment it starts following a real path
  await new Promise(resolve => bot.once('path_update', r => { if (r.status === 'success' || r.status === 'partial') resolve(); }));
  await sleep(300);
  bot.physicsEnabled = false; // the bot is now stuck between nodes
  await sleep(1500);
  console.log("frozen; executing=", agent.actions.executing);
  console.log('moving?', bot.pathfinder.isMoving(), 'pos', bot.entity.position.floored().toString(), 'executing', agent.actions.executing);
  const t = Date.now();
  await Promise.race([agent.actions.stop(), sleep(12000)]);
  const took = Date.now() - t;
  bot.physicsEnabled = true;
  console.log(`stop() returned after ${took} ms; killed=${killed}; executing=${agent.actions.executing}`);
  assert.equal(killed, null, 'process must not be killed');
  assert.ok(took < 5000, 'stop should finish well before the 10 s kill timer');
  console.log('PASS stuck action stopped without killing the process');
} finally {
  await releasePad(rcon); rcon.close(); bot.quit(); setTimeout(() => process.exit(0), 300);
}
