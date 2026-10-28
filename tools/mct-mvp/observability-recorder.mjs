import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const clone = value => JSON.parse(JSON.stringify(value));

export class RunRecorder {
    constructor({ root = 'run/evidence', runId = null, metadata = {} } = {}) {
        const safeId = runId || `${new Date().toISOString().replace(/[:.]/g, '-')}-script-demo`;
        this.run = {
            runId: safeId,
            status: 'running',
            startedAt: new Date().toISOString(),
            endedAt: null,
            metadata,
            pauseIntervals: []
        };
        this.dir = resolve(root, safeId);
        this.eventsPath = resolve(this.dir, 'events.jsonl');
        this.runPath = resolve(this.dir, 'run.json');
        this.events = [];
        this.agents = {};
        this.trajectories = {};
        this.listeners = new Set();
        mkdirSync(this.dir, { recursive: true });
        writeFileSync(this.eventsPath, '');
        this.record('run', null, { phase: 'started' });
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    record(type, agent = null, data = {}, links = {}) {
        const event = {
            runId: this.run.runId,
            seq: this.events.length + 1,
            wallTime: new Date().toISOString(),
            elapsedMs: Date.now() - Date.parse(this.run.startedAt),
            gameTick: data.gameTick ?? null,
            agent,
            type,
            ...links,
            data
        };
        this.events.push(event);
        appendFileSync(this.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
        this.persistRun();
        for (const listener of this.listeners) listener(event, this.getSnapshot());
        return event;
    }

    recordState(agent, state) {
        const position = state.position || {};
        const previous = this.agents[agent];
        this.agents[agent] = clone(state);
        if (!this.trajectories[agent]) this.trajectories[agent] = [];
        const last = this.trajectories[agent].at(-1);
        const moved = !last || Math.hypot((position.x ?? 0) - last.x, (position.z ?? 0) - last.z) >= 1;
        if (moved && Number.isFinite(position.x) && Number.isFinite(position.z)) {
            this.trajectories[agent].push({
                seq: this.events.length + 1,
                x: position.x,
                y: position.y ?? 0,
                z: position.z,
                gameTick: state.gameTick ?? null
            });
        }
        return this.record('state', agent, clone(state));
    }

    setStatus(status, data = {}) {
        if (status === this.run.status && !data.force) return null;
        const previous = this.run.status;
        this.run.status = status;
        if (status === 'paused') {
            this.run.pauseIntervals.push({ requestedAt: new Date().toISOString(), resumedAt: null });
        }
        if (status === 'running') {
            const interval = this.run.pauseIntervals.at(-1);
            if (interval && !interval.resumedAt) interval.resumedAt = new Date().toISOString();
        }
        return this.record('run', null, { phase: status, previous, ...data });
    }

    finish(data = {}) {
        this.run.endedAt = new Date().toISOString();
        this.run.status = 'finished';
        return this.record('run', null, { phase: 'finished', ...data });
    }

    persistRun() {
        writeFileSync(this.runPath, JSON.stringify(this.run, null, 2), 'utf8');
    }

    getSnapshot() {
        return clone({
            run: this.run,
            agents: this.agents,
            trajectories: this.trajectories,
            events: this.events
        });
    }
}
