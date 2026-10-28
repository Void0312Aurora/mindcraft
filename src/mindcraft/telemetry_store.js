import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export class TelemetryStore {
    constructor({ enabled = false, root = globalThis.process?.env?.MCT_TELEMETRY_ROOT || 'run/evidence', runId = globalThis.process?.env?.MCT_RUN_ID } = {}) {
        this.enabled = enabled;
        this.sequence = 0;
        this.recentEvents = [];
        this.maxRecentEvents = 2000;
        this.runId = runId || `${new Date().toISOString().replace(/[:.]/g, '-')}-mindcraft`;
        // A reused label is a new run, not permission to overwrite a recording
        // or reuse a client cursor. Shutdown recovery is outside this MVP.
        if (enabled && existsSync(resolve(root, this.runId))) {
            this.runId += `-${Date.now()}-${randomUUID().slice(0, 8)}`;
        }
        this.dir = resolve(root, this.runId);
        this.eventsPath = resolve(this.dir, 'events.jsonl');
        this.runPath = resolve(this.dir, 'run.json');
        this.run = {
            schemaVersion: 'mct-observation/v1',
            runId: this.runId,
            status: 'running',
            startedAt: new Date().toISOString(),
            endedAt: null,
            metadata: {
                source: 'mindcraft',
                minecraftVersion: globalThis.process?.env?.MCT_MINECRAFT_VERSION || null
            }
        };
        if (this.enabled) {
            mkdirSync(this.dir, { recursive: true });
            writeFileSync(this.eventsPath, '', 'utf8');
            this.persistRun();
        }
    }

    record(input) {
        if (!this.enabled) return null;
        const sequence = ++this.sequence;
        const event = {
            schema_version: input.schema_version || 'mct-observation/v1',
            run_id: this.runId,
            id: input.id || `${this.runId}-${sequence}-${randomUUID().slice(0, 8)}`,
            kind: input.kind || 'unknown',
            source: input.source || 'mindcraft',
            agent_id: input.agent_id || null,
            entity_id: input.entity_id || null,
            dimension: input.dimension || null,
            world_tick: input.world_tick ?? null,
            observed_at: new Date().toISOString(),
            monotonic_time: Number(globalThis.process.hrtime.bigint() / 1000000n),
            sequence,
            parent_ids: Array.isArray(input.parent_ids) ? input.parent_ids : [],
            action_id: input.action_id || null,
            goal_id: input.goal_id || null,
            path_id: input.path_id || null,
            origin: input.origin || 'controller',
            payload: input.payload || {}
        };
        appendFileSync(this.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
        this.recentEvents.push(event);
        if (this.recentEvents.length > this.maxRecentEvents) this.recentEvents.shift();
        return event;
    }

    snapshot(afterSequence = 0, expectedRunId = null) {
        const reset = !!expectedRunId && expectedRunId !== this.runId;
        const after = reset ? 0 : afterSequence;
        const firstSequence = this.recentEvents[0]?.sequence ?? this.sequence + 1;
        return {
            schema_version: 'mct-observation/v1',
            run_id: this.runId,
            status: this.run.status,
            sequence: this.sequence,
            reset,
            first_sequence: firstSequence,
            dropped_events: Math.max(0, firstSequence - after - 1),
            events: this.recentEvents.filter(event => event.sequence > after)
        };
    }

    finish(metadata = {}) {
        if (!this.enabled) return;
        this.run.status = 'finished';
        this.run.endedAt = new Date().toISOString();
        this.run.metadata = { ...this.run.metadata, ...metadata };
        this.persistRun();
    }

    persistRun() {
        writeFileSync(this.runPath, JSON.stringify(this.run, null, 2), 'utf8');
    }
}
