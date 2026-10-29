import { sendTelemetry } from '../agent/mindserver_proxy.js';

const telemetryEnabled = () => globalThis.process?.env?.MCT_TELEMETRY === '1';
const textEnabled = () => globalThis.process?.env?.MCT_TELEMETRY_TEXT === '1';
const SAMPLE_INTERVAL_MS = 1000;
const MAX_PATH_POINTS = 256;

function positionOf(value) {
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z))
        return null;
    return { x: Number(value.x.toFixed(2)), y: Number(value.y.toFixed(2)), z: Number(value.z.toFixed(2)) };
}

function goalSummary(goal) {
    if (!goal) return null;
    const result = { type: goal.constructor?.name || 'Goal' };
    for (const key of ['x', 'y', 'z', 'range', 'rangeSq', 'distance']) {
        if (Number.isFinite(goal[key])) result[key] = goal[key];
    }
    if (goal.entity?.username) result.entity = goal.entity.username;
    return result;
}

function textPayload(value) {
    return textEnabled() ? { text: String(value ?? '') } : { text_recorded: false };
}

export class AgentTelemetry {
    constructor(agent) {
        this.agent = agent;
        // Mindcraft restarts a crashed agent as a new process within the same
        // run; a per-process prefix keeps "<agent>-decision-1" from repeating.
        this.idPrefix = `${agent.name}-${Date.now().toString(36)}`;
        this.sequence = 0;
        this.decisionSequence = 0;
        this.actionSequence = 0;
        this.messageSequence = 0;
        this.goalSequence = 0;
        this.pathSequence = 0;
        this.goalId = null;
        this.pathId = null;
        this.activeActionId = null;
        this.lastPathEmitAt = 0;
        this.lastPathSignature = null;
        this.sampleTimer = null;
        this.lastSample = null;
        this.pendingSegmentBreak = false;
        this.attached = false;
    }

    emit(kind, payload = {}, fields = {}) {
        if (!telemetryEnabled()) return;
        const bot = this.agent.bot;
        sendTelemetry({
            id: fields.id || null,
            schema_version: 'mct-observation/v1',
            kind,
            source: fields.source || 'mindcraft',
            agent_id: this.agent.name,
            entity_id: bot?.username || this.agent.name,
            dimension: bot?.game?.dimension || null,
            world_tick: Number.isFinite(bot?.time?.age) ? bot.time.age : null,
            action_id: fields.action_id ?? this.activeActionId,
            goal_id: fields.goal_id || this.goalId,
            path_id: fields.path_id || this.pathId,
            parent_ids: fields.parent_ids || [],
            origin: fields.origin || 'controller',
            payload
        });
    }

    attach() {
        if (this.attached || !this.agent.bot || !telemetryEnabled()) return;
        this.attached = true;
        const bot = this.agent.bot;

        bot.on('goal_updated', (goal, dynamic) => {
            if (!goal) return; // Clearing navigation is not a new spatial goal.
            this.goalId = `${this.idPrefix}-goal-${++this.goalSequence}`;
            this.pathId = `${this.idPrefix}-path-${++this.pathSequence}`;
            this.emit('navigation.goal_set', { goal: goalSummary(goal), dynamic }, {
                source: 'mineflayer-pathfinder', origin: 'controller', goal_id: this.goalId,
                id: `${this.goalId}:set`,
                parent_ids: this.activeActionId ? [`${this.activeActionId}:started`] : []
            });
        });
        bot.on('path_update', result => {
            const path = Array.isArray(result?.path) ? result.path : [];
            const route = path.slice(0, MAX_PATH_POINTS).map(positionOf).filter(Boolean);
            const signature = JSON.stringify({
                status: result?.status || 'unknown',
                length: path.length,
                first: route[0] || null,
                last: route.at(-1) || null
            });
            const now = Date.now();
            if (now - this.lastPathEmitAt < 200 && signature === this.lastPathSignature) return;
            if (now - this.lastPathEmitAt < 200 && result?.status !== 'success'
                && result?.status !== 'noPath' && result?.status !== 'timeout') return;
            this.lastPathEmitAt = now;
            this.lastPathSignature = signature;
            this.emit('navigation.path_update', {
                status: result?.status || 'unknown',
                cost: Number.isFinite(result?.cost) ? result.cost : null,
                time: Number.isFinite(result?.time) ? result.time : null,
                route,
                truncated: path.length > MAX_PATH_POINTS
            }, { source: 'mineflayer-pathfinder', origin: 'controller',
                parent_ids: this.goalId ? [`${this.goalId}:set`] : [] });
        });
        bot.on('path_reset', reason => {
            this.emit('navigation.path_reset', { reason }, {
                source: 'mineflayer-pathfinder', origin: 'controller'
            });
        });
        bot.on('goal_reached', goal => {
            this.emit('navigation.goal_reached', { goal: goalSummary(goal) }, {
                source: 'mineflayer-pathfinder', origin: 'controller',
                parent_ids: this.goalId ? [`${this.goalId}:set`] : []
            });
        });
        bot.on('path_stop', () => {
            this.emit('navigation.path_stopped', {}, {
                source: 'mineflayer-pathfinder', origin: 'controller'
            });
        });
        // Mindcraft's own sunrise/noon/... events only fire on an exact tick,
        // but time packets arrive every ~20 ticks, so a running clock almost
        // never hits them. Detect crossings of each boundary instead.
        const BOUNDARIES = [[0, 'sunrise'], [6000, 'noon'], [12000, 'sunset'], [18000, 'midnight']];
        bot.on('time', () => {
            const time = bot.time?.time;
            if (!Number.isFinite(time)) return;
            const previous = this.lastClock;
            this.lastClock = time;
            if (!Number.isFinite(previous) || time <= previous) {
                // First sample, frozen clock or /time set backwards: only an exact boundary counts.
                const exact = BOUNDARIES.find(([tick]) => tick === bot.time.timeOfDay);
                if (exact) this.timeBoundary(exact[1], bot.time.day);
                return;
            }
            for (let day = Math.floor(previous / 24000); day <= Math.floor(time / 24000); day++) {
                for (const [tick, event] of BOUNDARIES) {
                    const at = day * 24000 + tick;
                    if (at > previous && at <= time) this.timeBoundary(event, day);
                }
            }
        });
        bot.on('death', () => {
            this.pendingSegmentBreak = true;
            this.emit('world.death', {}, { source: 'minecraft', origin: 'minecraft' });
        });
        bot.on('autoeat_started', food => this.emit('world.food_started', {
            item: food?.name || null
        }, { source: 'mineflayer-auto-eat', origin: 'controller' }));
        bot.on('autoeat_finished', food => this.emit('world.food_finished', {
            item: food?.name || null
        }, { source: 'mineflayer-auto-eat', origin: 'controller' }));
        bot.on('autoeat_error', error => this.emit('world.food_failed', {
            error: String(error?.message || error)
        }, { source: 'mineflayer-auto-eat', origin: 'controller' }));

        this.sampleTimer = setInterval(() => this.samplePosition(), SAMPLE_INTERVAL_MS);
        this.sampleTimer.unref?.();
        const clear = () => this.detach();
        bot.once('end', clear);
        bot.once('kicked', clear);
    }

    detach() {
        if (this.sampleTimer) clearInterval(this.sampleTimer);
        this.sampleTimer = null;
    }

    timeBoundary(event, day) {
        // A frozen clock repeats the same boundary on every packet; record it once per day.
        if (this.lastTimeBoundary?.event === event && this.lastTimeBoundary.day === day) return;
        this.lastTimeBoundary = { event, day };
        this.emit('world.time_boundary', { event, day }, { source: 'minecraft', origin: 'minecraft' });
    }

    samplePosition() {
        const bot = this.agent.bot;
        const position = positionOf(bot?.entity?.position);
        if (!position) return;
        const previous = this.lastSample;
        const dimension = bot?.game?.dimension || null;
        const distance = previous ? Math.hypot(position.x - previous.x, position.y - previous.y, position.z - previous.z) : 0;
        const segmentBreak = !!previous && (this.pendingSegmentBreak || previous.dimension !== dimension || distance >= 32);
        const moved = !previous || Math.hypot(position.x - previous.x, position.y - previous.y, position.z - previous.z) >= 1;
        if (!moved && previous?.health === bot.health && previous?.hunger === bot.food) return;
        this.lastSample = { ...position, health: bot.health, hunger: bot.food, dimension };
        this.pendingSegmentBreak = false;
        this.emit('agent.position_sample', {
            position,
            health: Number.isFinite(bot.health) ? Math.round(bot.health) : null,
            hunger: Number.isFinite(bot.food) ? Math.round(bot.food) : null,
            action: this.agent.actions?.currentActionLabel || null,
            segment_break: segmentBreak
        }, { source: 'minecraft', origin: 'minecraft' });
    }

    stateSnapshot() {
        const bot = this.agent.bot;
        return {
            position: positionOf(bot?.entity?.position),
            dimension: bot?.game?.dimension || null,
            health: Number.isFinite(bot?.health) ? Math.round(bot.health) : null,
            hunger: Number.isFinite(bot?.food) ? Math.round(bot.food) : null,
            time_of_day: Number.isFinite(bot?.time?.timeOfDay) ? bot.time.timeOfDay : null,
            action: this.agent.actions?.currentActionLabel || null
        };
    }

    decisionRequested(source, message, state = {}, parentIds = []) {
        const decisionId = `${this.idPrefix}-decision-${++this.decisionSequence}`;
        this.emit('decision.requested', {
            decision_id: decisionId,
            source,
            ...textPayload(message),
            state: { ...this.stateSnapshot(), ...state }
        }, { source: 'mindcraft', origin: 'controller', id: `${decisionId}:requested`, parent_ids: parentIds });
        return decisionId;
    }

    decisionCompleted(decisionId, response, command = null) {
        this.emit('decision.completed', {
            decision_id: decisionId,
            ...textPayload(response),
            command
        }, {
            source: 'mindcraft', origin: 'model_report', id: `${decisionId}:completed`,
            parent_ids: [`${decisionId}:requested`]
        });
        return decisionId;
    }

    actionStarted(label, decisionId = null) {
        const actionId = `${this.idPrefix}-action-${++this.actionSequence}`;
        // The next action has not assigned a target yet. Do not attribute the
        // previous action's goal/path to its start event.
        this.goalId = null;
        this.pathId = null;
        this.activeActionId = actionId;
        this.emit('action.started', { label }, {
            source: 'action_manager', origin: 'controller', action_id: actionId,
            id: `${actionId}:started`,
            parent_ids: decisionId ? [`${decisionId}:completed`] : []
        });
        return actionId;
    }

    actionCompleted(actionId, result) {
        const failed = result?.timedout || result?.success === false;
        const kind = result?.interrupted ? 'action.interrupted' : failed ? 'action.failed' : 'action.completed';
        const suffix = result?.interrupted ? 'interrupted' : failed ? 'failed' : 'completed';
        this.emit(kind, {
            success: !!result?.success,
            interrupted: !!result?.interrupted,
            timedout: !!result?.timedout,
            message_recorded: textEnabled() && typeof result?.message === 'string',
            ...(textEnabled() && typeof result?.message === 'string' ? { message: result.message } : {})
        }, {
            source: 'action_manager', origin: 'controller', action_id: actionId,
            id: `${actionId}:${suffix}`, parent_ids: [`${actionId}:started`]
        });
        this.lastActionEndId = `${actionId}:${suffix}`;
        if (this.activeActionId === actionId) this.activeActionId = null;
    }

    actionFailed(actionId, error) {
        this.emit('action.failed', { error: String(error?.message || error) }, {
            source: 'action_manager', origin: 'controller', action_id: actionId,
            id: `${actionId}:failed`, parent_ids: [`${actionId}:started`]
        });
        this.lastActionEndId = `${actionId}:failed`;
        if (this.activeActionId === actionId) this.activeActionId = null;
    }

    /** Id of the most recent action end, consumed by the follow-up decision. */
    takeLastActionEnd() {
        const id = this.lastActionEndId || null;
        this.lastActionEndId = null;
        return id;
    }

    codeAttempt(attempt, code, outcome, detail = null) {
        // Generated code is model output, so it follows the text redaction switch.
        this.emit('code.attempt', {
            attempt,
            outcome,
            ...(textEnabled() ? { code, ...(detail ? { detail: String(detail) } : {}) } : { code_recorded: false })
        }, {
            source: 'coder', origin: 'model_report', action_id: this.activeActionId,
            // one attempt can emit "executing" then its result; the outcome keeps both ids unique
            id: `${this.activeActionId || this.idPrefix}-code-${attempt}:${outcome}`,
            parent_ids: this.activeActionId ? [`${this.activeActionId}:started`] : []
        });
    }

    messageSent(recipient, message) {
        const messageId = `${this.idPrefix}-message-${++this.messageSequence}`;
        this.emit('message.sent', { message_id: messageId, recipient, ...textPayload(message) }, {
            source: 'conversation', origin: 'controller', id: `${messageId}:sent`
        });
        return messageId;
    }

    messageDelivered(sender, received) {
        this.emit('message.delivered', {
            message_id: received?.telemetry_id || null,
            sender,
            ...textPayload(received?.message)
        }, {
            source: 'conversation', origin: 'controller',
            parent_ids: received?.telemetry_id ? [`${received.telemetry_id}:sent`] : []
        });
    }
}
