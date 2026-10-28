// Infrastructure check only: use Mindcraft's bot initialization, with no models.
import { mkdirSync, writeFileSync } from 'node:fs';
import { setSettings } from '../../src/agent/settings.js';
import { initBot } from '../../src/utils/mcdata.js';
import { runtimeEnvironment } from './runtime-config.mjs';

const runtime = runtimeEnvironment(process.env.MCT_SMOKE_RUNTIME_PROFILE || 'journey');
setSettings({ host: runtime.minecraft.host, port: runtime.minecraft.port, auth: 'offline', minecraft_version: runtime.minecraft.version });
const expectedGameMode = process.env.MCT_EXPECTED_GAMEMODE || (runtime.name === 'journey' ? 'survival' : null);
const names = ['MCT_Probe_A', 'MCT_Probe_B', 'MCT_Probe_C'];
const bots = [];
const results = [];
try {
    for (const username of names) {
        const bot = initBot(username);
        bots.push(bot);
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`${username}: spawn timeout`)), 120_000);
            const fail = (reason) => { clearTimeout(timer); reject(new Error(`${username}: ${String(reason)}`)); };
            bot.once('error', fail);
            bot.once('kicked', fail);
            bot.once('spawn', () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }
    for (const bot of bots) {
        if (bot.health === undefined || bot.food === undefined) throw new Error(`${bot.username}: health/food not received`);
        if (expectedGameMode && bot.game.gameMode !== expectedGameMode)
            throw new Error(`${bot.username}: expected ${expectedGameMode}, got ${bot.game.gameMode}`);
        results.push({ name: bot.username, version: bot.version, mode: bot.game.gameMode, health: bot.health, food: bot.food, saturation: bot.foodSaturation, position: bot.entity.position, visiblePlayers: Object.keys(bot.players) });
    }
    mkdirSync('run/evidence', { recursive: true });
    const report = { at: new Date().toISOString(), scope: 'Three simultaneous Mineflayer connections using Mindcraft initBot; no LLM, route, survival, or cooperation evaluation.', passed: true, bots: results };
    writeFileSync('run/evidence/smoke.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    for (const bot of bots) bot.quit('MCT infrastructure check complete');
}
