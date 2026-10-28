import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TelemetryStore } from '../../src/mindcraft/telemetry_store.js';

const root = mkdtempSync(join(tmpdir(), 'mct-telemetry-'));
try {
    const store = new TelemetryStore({ enabled: true, root, runId: 'contract-smoke' });
    const requested = store.record({
        kind: 'decision.requested',
        source: 'mindcraft',
        agent_id: 'MCT_A',
        origin: 'controller',
        payload: { source: 'system' }
    });
    const completed = store.record({
        kind: 'decision.completed',
        source: 'mindcraft',
        agent_id: 'MCT_A',
        origin: 'model_report',
        parent_ids: [requested.id],
        payload: { command: '!goTo' }
    });
    const action = store.record({
        kind: 'action.started',
        source: 'action_manager',
        agent_id: 'MCT_A',
        action_id: 'MCT_A-action-1',
        origin: 'controller',
        parent_ids: [completed.id],
        payload: { label: 'goTo' }
    });

    const lines = readFileSync(join(root, 'contract-smoke', 'events.jsonl'), 'utf8')
        .trim().split('\n').map(line => JSON.parse(line));
    if (lines.length !== 3) throw new Error(`expected 3 events, got ${lines.length}`);
    if (new Set(lines.map(event => event.id)).size !== lines.length) throw new Error('event IDs are not unique');
    if (lines[1].parent_ids[0] !== requested.id) throw new Error('causal parent was not retained');
    if (lines[2].parent_ids[0] !== completed.id) throw new Error('action parent was not retained');
    if (lines.some(event => event.schema_version !== 'mct-observation/v1')) throw new Error('schema version mismatch');

    const second = new TelemetryStore({ enabled: true, root, runId: 'contract-smoke' });
    if (second.runId === store.runId) throw new Error('reused label must receive a fresh run ID');
    if (readFileSync(store.eventsPath, 'utf8').trim().split('\n').length !== 3) throw new Error('old recording was overwritten');
    second.maxRecentEvents = 1;
    second.record({ kind: 'one' }); second.record({ kind: 'two' });
    const gap = second.snapshot(0, second.runId);
    if (gap.events.length !== 1 || gap.first_sequence !== 2 || gap.dropped_events !== 1) throw new Error('bounded cache gap must be explicit');
    second.finish();

    store.finish({ test: 'contract-smoke' });
    console.log(JSON.stringify({ ok: true, events: lines.length, runId: store.runId }));
} finally {
    rmSync(root, { recursive: true, force: true });
}
