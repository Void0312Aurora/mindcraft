import { createBot } from 'mineflayer';
import pathfinderPackage from 'mineflayer-pathfinder';
import { io } from 'socket.io-client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runtimeEnvironment } from './runtime-config.mjs';

const env = process.env;
const runtime = runtimeEnvironment();
const agentName = env.MCT_AGENT_NAME || 'MCT_SCRIPT_A';
const mcHost = env.MCT_MC_HOST || runtime.minecraft.host;
const mcPort = Number(env.MCT_MC_PORT || runtime.minecraft.port);
const mcVersion = env.MCT_MINECRAFT_VERSION || runtime.minecraft.version;
const mindServerUrl = env.MCT_MINDSERVER_URL || runtime.mindserver.url;
const timeoutMs = Number(env.MCT_PATHFINDER_TIMEOUT_MS || 30000);
const goalRange = Number(env.MCT_GOAL_RANGE || 3);
const preGoalDelayMs = Number(env.MCT_PRE_GOAL_DELAY_MS || 0);
const runId = env.MCT_RUN_ID || 'real-pathfinder-agent';
const { goals, Movements, pathfinder } = pathfinderPackage;

const positionOf = value => value && [value.x, value.y, value.z].every(Number.isFinite)
    ? { x: Number(value.x.toFixed(2)), y: Number(value.y.toFixed(2)), z: Number(value.z.toFixed(2)) }
    : null;

const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));

const socket = io(mindServerUrl, { reconnection: false });
let bot = null;

let sequence = 0;
let goalSequence = 0;
let pathSequence = 0;
let goalId = null;
let pathId = null;
let sampleTimer = null;
let lastSample = null;
let startPosition = null;
let target = null;
let goalReached = false;
let finished = false;
const eventKinds = [];

function emit(kind, payload = {}, fields = {}) {
    const event = {
        id: fields.id || `${agentName}-script-${++sequence}`,
        schema_version: 'mct-observation/v1',
        kind,
        source: fields.source || 'mct-script-agent',
        agent_id: agentName,
        entity_id: bot.username || agentName,
        dimension: bot.game?.dimension || null,
        world_tick: Number.isFinite(bot.time?.age) ? bot.time.age : null,
        action_id: fields.action_id || null,
        goal_id: fields.goal_id || goalId,
        path_id: fields.path_id || pathId,
        parent_ids: fields.parent_ids || [],
        origin: fields.origin || 'controller',
        payload
    };
    eventKinds.push(kind);
    socket.emit('telemetry-event', event);
}

function samplePosition() {
    const position = positionOf(bot.entity?.position);
    if (!position) return;
    const previous = lastSample;
    const moved = !previous || Math.hypot(position.x - previous.x, position.z - previous.z) >= 1;
    if (!moved && previous.health === bot.health && previous.hunger === bot.food) return;
    lastSample = { ...position, health: bot.health, hunger: bot.food };
    emit('agent.position_sample', {
        position,
        health: Number.isFinite(bot.health) ? Math.round(bot.health) : null,
        hunger: Number.isFinite(bot.food) ? Math.round(bot.food) : null,
        action: 'pathfinder'
    }, { source: 'minecraft', origin: 'minecraft' });
}

function routeOf(result) {
    const source = Array.isArray(result?.path) ? result.path : [];
    return source.slice(0, 256).map(positionOf).filter(Boolean);
}

function attachPathfinderTelemetry() {
    bot.on('goal_updated', (goal, dynamic) => {
        goalId = `${agentName}-goal-${++goalSequence}`;
        pathId = `${agentName}-path-${++pathSequence}`;
        emit('navigation.goal_set', {
            goal: {
                type: goal?.constructor?.name || 'Goal',
                x: goal?.x ?? null,
                y: goal?.y ?? null,
                z: goal?.z ?? null,
                range: goal?.range ?? null
            },
            dynamic: !!dynamic
        }, { source: 'mineflayer-pathfinder', origin: 'controller' });
    });
    bot.on('path_update', result => {
        const route = routeOf(result);
        emit('navigation.path_update', {
            status: result?.status || 'unknown',
            cost: Number.isFinite(result?.cost) ? result.cost : null,
            time: Number.isFinite(result?.time) ? result.time : null,
            route,
            truncated: Array.isArray(result?.path) && result.path.length > route.length
        }, { source: 'mineflayer-pathfinder', origin: 'controller' });
    });
    bot.on('path_reset', reason => emit('navigation.path_reset', { reason }, {
        source: 'mineflayer-pathfinder', origin: 'controller'
    }));
    bot.on('path_stop', () => emit('navigation.path_stopped', {}, {
        source: 'mineflayer-pathfinder', origin: 'controller'
    }));
    bot.on('goal_reached', goal => {
        goalReached = true;
        emit('navigation.goal_reached', {
            goal: { x: goal?.x ?? null, y: goal?.y ?? null, z: goal?.z ?? null }
        }, { source: 'mineflayer-pathfinder', origin: 'controller' });
    });
}

function waitForSocket() {
    return new Promise((resolveSocket, rejectSocket) => {
        const timer = setTimeout(() => rejectSocket(new Error(`MindServer connection timed out: ${mindServerUrl}`)), 5000);
        socket.once('connect', () => {
            clearTimeout(timer);
            resolveSocket();
        });
        socket.once('connect_error', error => {
            clearTimeout(timer);
            rejectSocket(error);
        });
    });
}

function waitForSpawn() {
    return new Promise((resolveSpawn, rejectSpawn) => {
        const timer = setTimeout(() => rejectSpawn(new Error('Minecraft spawn timed out')), 15000);
        bot.once('spawn', () => {
            clearTimeout(timer);
            resolveSpawn();
        });
        bot.once('error', rejectSpawn);
    });
}

async function finish(status, error = null) {
    if (finished) return;
    finished = true;
    if (sampleTimer) clearInterval(sampleTimer);
    try { bot?.pathfinder?.stop(); } catch { /* already disconnected */ }
    await sleep(300);
    const summary = {
        run_id: runId,
        agent_id: agentName,
        status,
        error: error ? String(error.message || error) : null,
        start: startPosition,
        target,
        end: positionOf(bot?.entity?.position),
        event_kinds: [...new Set(eventKinds)],
        event_count: eventKinds.length
    };
    const evidenceDir = resolve(env.MCT_TELEMETRY_ROOT || 'run/evidence', runId);
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(resolve(evidenceDir, `${agentName}-script-summary.json`), JSON.stringify(summary, null, 2));
    try { bot?.quit('MCT script agent finished'); } catch { /* no-op */ }
    socket.close();
    console.log(JSON.stringify(summary));
}

async function main() {
    await waitForSocket();
    bot = createBot({
        username: agentName,
        host: mcHost,
        port: mcPort,
        version: mcVersion,
        auth: 'offline'
    });
    bot.loadPlugin(pathfinder);
    await waitForSpawn();
    attachPathfinderTelemetry();
    sampleTimer = setInterval(samplePosition, 1000);
    samplePosition();

    const start = positionOf(bot.entity.position);
    startPosition = start;
    const explicitTarget = [env.MCT_TARGET_X, env.MCT_TARGET_Y, env.MCT_TARGET_Z].every(value => value !== undefined);
    target = explicitTarget
        ? { x: Number(env.MCT_TARGET_X), y: Number(env.MCT_TARGET_Y), z: Number(env.MCT_TARGET_Z) }
        : { x: Math.round(start.x + 24), y: Math.round(start.y), z: Math.round(start.z + 16) };

    if (preGoalDelayMs > 0) await sleep(preGoalDelayMs);

    const movements = new Movements(bot);
    bot.pathfinder.setMovements(movements);
    bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, goalRange));
    console.log(JSON.stringify({ agent_id: agentName, start, target, goal_range: goalRange, server: `${mcHost}:${mcPort}` }));

    await new Promise(resolveGoal => {
        const timer = setTimeout(resolveGoal, timeoutMs);
        bot.once('goal_reached', () => {
            clearTimeout(timer);
            resolveGoal();
        });
    });
    await finish(goalReached ? 'goal_reached' : 'timeout');
}

main().catch(async error => {
    await finish('error', error);
    process.exitCode = 1;
});

process.on('SIGINT', () => finish('interrupted'));
