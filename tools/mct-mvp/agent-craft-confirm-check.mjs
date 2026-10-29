// Live check against the survival server (25587, RCON 25576); requires the server running.
// Live check for the craft-confirmation fix on the survival server:
// 1) a normal 3x3 craft still reports success with the server's count,
// 2) a craft the server does not apply (crafting window opened on a table
//    that the server removes) is reported as failed, not as a phantom item.
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
const bot = mc.initBot('MCT_Check'); bot.output = '';
bot.modes = { isOn: () => false, pause() {}, unpause() {} };
const rcon = new RconClient({ password: 'mct-observability', port: 25576 });
await new Promise(r => bot.once('spawn', r)); await rcon.connect();
const c = x => rcon.command(x); const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = async item => Number(((await c(`clear MCT_Check ${item} 0`)).body.match(/Found (\d+)/) || [0, 0])[1]);
const reset = async () => {
  await preparePad(rcon);
  await c('clear MCT_Check'); await c('tp MCT_Check 202.5 151 202.5');
  await c('give MCT_Check spruce_planks 12'); await c('give MCT_Check stick 3');
  await c('setblock 204 151 202 crafting_table');
  await sleep(1200); bot.output = '';
};
try {
  await c('gamemode survival MCT_Check');

  await reset();
  let ok = await skills.craftRecipe(bot, 'wooden_pickaxe', 1);
  assert.equal(ok, true); assert.equal(await srv('wooden_pickaxe'), 1);
  assert.match(bot.output, /Successfully crafted wooden_pickaxe, you now have 1 wooden_pickaxe/);
  console.log('PASS normal craft:', bot.output.trim().split('\n').at(-1));

  // Server-side rejection, the run-07 case: the clicks reach the server but it
  // refuses the result, while mineflayer has already written it locally. Model it
  // by letting the craft run normally, then having the server take the item back
  // before its inventory sync reaches the bot.
  await reset();
  bot._client.once('close_window', () => {});
  const trace = [];
  const t0 = Date.now();
  const onPkt = name => p => { if (p.windowId === 0 || name === 'close') trace.push(`+${Date.now() - t0} ${name} win=${p.windowId} slot=${p.slot ?? ''} item=${p.item?.itemId ?? (p.items ? p.items.length + ' items' : 'empty')}`); };
  const ss = onPkt('set_slot'), wi = onPkt('window_items');
  bot._client.on('set_slot', ss); bot._client.on('window_items', wi);
  const rawWrite = bot._client.write.bind(bot._client);
  bot._client.write = (name, p) => {
    if (name === 'close_window') { trace.push(`+${Date.now() - t0} -> close_window`); setTimeout(() => c('clear MCT_Check wooden_pickaxe').then(r => trace.push(`+${Date.now() - t0} rcon clear: ${r.body}`)), 200); }
    return rawWrite(name, p);
  };
  ok = await skills.craftRecipe(bot, 'wooden_pickaxe', 1);
  trace.push(`+${Date.now() - t0} craftRecipe returned ${ok}`);
  bot._client.write = rawWrite;
  await sleep(800);
  bot._client.off('set_slot', ss); bot._client.off('window_items', wi);
  console.log('   trace:\n     ' + trace.join('\n     '));
  await sleep(800);
  const server = await srv('wooden_pickaxe');
  console.log(`rejected craft -> returned ${ok}, server has ${server}, local has ${world.getInventoryCounts(bot).wooden_pickaxe || 0}`);
  console.log('   output:', bot.output.trim().replace(/\n/g, ' | '));
  if (server === 0) {
    assert.equal(ok, false, 'a craft the server did not apply must not report success');
    assert.match(bot.output, /did not take effect on the server: you still have 0/);
    console.log('PASS rejected craft reported as failed');
  } else {
    console.log('NOTE server still applied the craft; rejection not reproduced this way');
  }
} finally {
  await releasePad(rcon); rcon.close(); bot.quit(); setTimeout(() => process.exit(0), 300);
}
