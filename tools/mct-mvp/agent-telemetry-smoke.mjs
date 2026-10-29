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
const failedId = telemetry.actionStarted('goTo unreachable', decisionId);
telemetry.actionCompleted(failedId, { success: false, interrupted: false, timedout: false });
assert.equal(events.at(-1).event.kind, 'action.failed', 'a skill returning false must be reported as failed');
assert.equal(events.at(-1).event.id, `${failedId}:failed`);
const boundaries = () => events.filter(({ event }) => event.kind === 'world.time_boundary').map(({ event }) => `${event.payload.event}@${event.payload.day}`);
const tick = time => { bot.time = { time, timeOfDay: time % 24000, day: Math.floor(time / 24000) }; bot.emit('time'); };
tick(6000); tick(6000); tick(6000);
assert.deepEqual(boundaries(), ['noon@0'], 'a frozen clock must not repeat the same time boundary');
tick(11990); tick(12010); tick(17995); tick(18015);
assert.deepEqual(boundaries(), ['noon@0', 'sunset@0', 'midnight@0'], 'a running clock that skips the exact tick still crosses each boundary');
tick(23990); tick(24010);
assert.deepEqual(boundaries().at(-1), 'sunrise@1', 'sunrise crosses into the next day');
tick(30010);
assert.deepEqual(boundaries().at(-1), 'noon@1', 'the next day records noon again');
const followUp = telemetry.decisionRequested('system', 'Unable to reach 10, 120, 40', { follow_up: true }, [telemetry.takeLastActionEnd()]);
const followEvent = events.at(-1).event;
assert.deepEqual(followEvent.parent_ids, [`${failedId}:failed`], 'a follow-up decision must point at the action end that triggered it');
assert.equal(telemetry.takeLastActionEnd(), null, 'an action end is consumed by one follow-up only');
telemetry.decisionCompleted(followUp, '!newAction("pillar up")', '!newAction');
const codeActionId = telemetry.actionStarted('action:newAction', followUp);
telemetry.codeAttempt(1, 'await skills.placeBlock(bot, "dirt", 0, 0, 0);', 'lint_error', 'unknown skill');
const codeEvent = events.at(-1).event;
assert.equal(codeEvent.kind, 'code.attempt');
assert.equal(codeEvent.action_id, codeActionId, 'code attempts belong to the running newAction');
assert.deepEqual(codeEvent.parent_ids, [`${codeActionId}:started`]);
assert.equal(codeEvent.payload.code_recorded, false, 'generated code follows the text redaction switch');
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
