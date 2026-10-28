import { createBot } from 'mineflayer';
import pathfinderPackage from 'mineflayer-pathfinder';
import { io } from 'socket.io-client';
import { once } from 'node:events';
import { createInterface } from 'node:readline/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runtimeEnvironment } from './runtime-config.mjs';
import { RconClient } from './rcon-client.mjs';
import { AgentTelemetry } from '../../src/observability/agent_telemetry.js';
import { serverProxy } from '../../src/agent/mindserver_proxy.js';

// This is an operator-stepped SCRIPT demonstration, with real Minecraft moves.
// All instructions and interruptions are prescribed here; no LLM is invoked.
process.env.MCT_TELEMETRY = '1';
process.env.MCT_TELEMETRY_TEXT = '1';
process.env.MCT_RUN_ID ||= `single-observer-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const { createMindServer, getTelemetryStore } = await import('../../src/mindcraft/mindserver.js');
const runtime = runtimeEnvironment();
const server = createMindServer(false, runtime.mindserver.port);
await once(server, 'listening');
const rl = createInterface({ input: process.stdin, output: process.stdout });
const socket = io(runtime.mindserver.url, { reconnection: false });
await once(socket, 'connect');
serverProxy.socket = socket;
serverProxy.connected = true;
const { Movements, goals, pathfinder } = pathfinderPackage;
let bot, telemetry, rcon;
const outcomes = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const checkpoint = async stage => {
    console.log(JSON.stringify({ checkpoint: stage, run_id: getTelemetryStore().runId,
        sequence: getTelemetryStore().sequence, agent: bot?.username || null }));
    if (process.env.MCT_AUTO_CONTINUE !== '1') {
        await rl.question('Press Enter to continue (observer only; world keeps running): ');
    }
};

function instruction(text, command) {
    const id = telemetry.decisionRequested('script', text);
    telemetry.emit('decision.completed', { decision_id: id, text, command, prescribed: true }, {
        id: `${id}:completed`, source: 'mct-script-agent', origin: 'controller', parent_ids: [`${id}:requested`]
    });
    return id;
}

async function travel(target, decision, interrupt = false) {
    const action = telemetry.actionStarted('script goTo', decision);
    botAgent.actions.currentActionLabel = 'script goTo';
    const start = bot.entity.position.clone();
    const result = new Promise((resolveResult, reject) => {
        const timer = setTimeout(() => done(new Error('Pathfinder did not finish within 45s')), 45000);
        const reached = () => done(null);
        const movement = () => {
            if (!interrupt || bot.entity.position.distanceTo(start) < 3) return;
            bot.pathfinder.setGoal(null);
            bot.clearControlStates();
            done(null, true);
        };
        function done(error, interrupted = false) {
            clearTimeout(timer);
            bot.off('goal_reached', reached);
            bot.off('physicsTick', movement);
            if (error) reject(error); else resolveResult(interrupted);
        }
        bot.once('goal_reached', reached);
        bot.on('physicsTick', movement);
    });
    bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, 2));
    console.log(JSON.stringify({ stage: interrupt ? 'travelling-will-interrupt' : 'travelling', target }));
    try {
        const interrupted = await result;
        telemetry.samplePosition();
        telemetry.actionCompleted(action, { success: !interrupted, interrupted,
            message: interrupted ? 'Script deliberately interrupted navigation after 3 blocks; next instruction replaces the target.' : 'Pathfinder emitted goal_reached.' });
        botAgent.actions.currentActionLabel = 'idle';
        telemetry.emit('agent.position_sample', { position: bot.entity.position, health: bot.health, hunger: bot.food, action: 'idle' }, { source: 'minecraft', origin: 'minecraft' });
        outcomes.push({ target, status: interrupted ? 'interrupted' : 'arrived', position: bot.entity.position.clone() });
    } catch (error) {
        bot.pathfinder.setGoal(null); bot.clearControlStates();
        telemetry.actionFailed(action, error); throw error;
    }
    await sleep(250);
}

let botAgent;
try {
    if (process.argv.includes('--empty')) {
        await checkpoint('empty-run');
    } else {
        bot = createBot({ username: 'MCT_A', host: runtime.minecraft.host, port: runtime.minecraft.port,
            version: runtime.minecraft.version, auth: 'offline' });
        bot.loadPlugin(pathfinder);
        await once(bot, 'spawn');
        const properties = readFileSync(resolve('run', runtime.minecraft.server, 'server.properties'), 'utf8');
        const password = properties.match(/^\s*rcon.password=(.*)$/m)?.[1]?.trim();
        if (!password) throw new Error('Local test server RCON password unavailable');
        rcon = new RconClient({ password }); await rcon.connect();
        await rcon.command('weather clear');
        await rcon.command('time set noon');
        await rcon.command('tp MCT_A -49.5 71 -22.5');
        for (let i = 0; i < 40 && Math.abs(bot.entity.position.x + 49.5) > 1; i++) await sleep(100);
        if (Math.abs(bot.entity.position.x + 49.5) > 1) throw new Error('Test start teleport not confirmed');
        const movement = new Movements(bot);
        movement.canDig = false;
        movement.allow1by1towers = false;
        bot.pathfinder.setMovements(movement);
        botAgent = { name: 'MCT_A', bot, actions: { currentActionLabel: 'idle' } };
        telemetry = new AgentTelemetry(botAgent);
        telemetry.attach(); telemetry.samplePosition();
        await checkpoint('ready');
        await travel({ x: -10, y: 65, z: 20 }, instruction('脚本任务：前往水渠旁目标 A。', 'goTo(-10,65,20)'));
        await checkpoint('arrived');
        await travel({ x: -49, y: 71, z: -22 }, instruction('脚本任务：返回起点；移动 3 方块后由脚本中断。', 'goTo(-49,71,-22)'), true);
        await checkpoint('interrupted');
        await travel({ x: -10, y: 65, z: 20 }, instruction('脚本改令：取消返回任务，重新前往水渠旁。', 'goTo(-10,65,20)'));
        await checkpoint('redirected-arrived');
        writeFileSync(resolve(getTelemetryStore().dir, 'scenario-summary.json'), JSON.stringify({
            run_id: getTelemetryStore().runId, agent: 'MCT_A', source: 'script', llm_calls: 0, outcomes
        }, null, 2));
    }
} catch (error) {
    console.error(error); process.exitCode = 1;
} finally {
    telemetry?.detach(); bot?.quit(); rcon?.close(); socket.close(); rl.close();
    serverProxy.connected = false; serverProxy.socket = null;
    getTelemetryStore().finish({ source: 'script', llm_calls: 0, outcomes });
    await new Promise(r => server.close(r));
}
