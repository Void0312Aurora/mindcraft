import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { AgentTelemetry } from '../../src/observability/agent_telemetry.js';
import { serverProxy } from '../../src/agent/mindserver_proxy.js';

const events = [];
process.env.MCT_TELEMETRY = '1';
serverProxy.connected = true;
serverProxy.socket = { emit: (name, event) => events.push({ name, event }) };

const bot = new EventEmitter();
bot.username = 'MCT_A';
bot.game = { dimension: 'minecraft:overworld' };
bot.time = { age: 20 };
bot.entity = { position: { x: 1, y: 65, z: 2 } };
bot.health = 20;
bot.food = 20;
const agent = { name: 'MCT_A', bot, actions: { currentActionLabel: 'Walking' } };
const telemetry = new AgentTelemetry(agent);
telemetry.attach();

bot.emit('goal_updated', { x: 10, y: 65, z: 12, constructor: { name: 'GoalNear' } }, false);
bot.emit('path_update', { status: 'success', cost: 11, time: 4, path: [
    { x: 1, y: 65, z: 2 }, { x: 4, y: 65, z: 5 }, { x: 10, y: 65, z: 12 }
] });
const decisionId = telemetry.decisionRequested('system', 'find the destination');
telemetry.decisionCompleted(decisionId, '!goTo(10,65,12)', '!goTo');
const actionId = telemetry.actionStarted('goTo', decisionId);
assert.equal(events.at(-1).event.goal_id, null, 'new action must not inherit previous target');
bot.emit('goal_updated', { x: 11, y: 65, z: 12, constructor: { name: 'GoalNear' } }, false);
const currentGoal = events.at(-1).event;
assert.equal(currentGoal.action_id, actionId);
assert.deepEqual(currentGoal.parent_ids, [`${actionId}:started`]);
bot.emit('goal_updated', null, false);
assert.equal(events.at(-1).event.id, currentGoal.id, 'clearing navigation is not a new target');
bot.emit('goal_reached', { x: 11, y: 65, z: 12 });
assert.deepEqual(events.at(-1).event.parent_ids, [currentGoal.id]);
telemetry.actionCompleted(actionId, { success: true, interrupted: false, timedout: false });
telemetry.samplePosition();

telemetry.detach();
serverProxy.connected = false;
serverProxy.socket = null;

assert.ok(events.length >= 6, `expected event transport, got ${events.length}`);
assert.ok(events.some(({ event }) => event.kind === 'navigation.path_update'));
assert.ok(events.some(({ event }) => event.kind === 'agent.position_sample'));
const action = events.find(({ event }) => event.kind === 'action.started').event;
assert.deepEqual(action.parent_ids, [`${decisionId}:completed`]);
assert.equal(action.action_id, actionId);
console.log(JSON.stringify({ ok: true, events: events.length, kinds: [...new Set(events.map(({ event }) => event.kind))] }));
