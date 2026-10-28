import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { io } from 'socket.io-client';

void (async () => {
    process.env.MCT_TELEMETRY = '1';
    process.env.MCT_RUN_ID = `bridge-smoke-${Date.now()}`;
    const { createMindServer, getTelemetryStore } = await import('../../src/mindcraft/mindserver.js');

    const server = createMindServer(false, 18124);
    const client = io('http://localhost:18124', { reconnection: false });
    try {
        await once(client, 'connect');
        const eventPromise = once(client, 'telemetry-event');
        client.emit('telemetry-event', {
            id: 'MCT_A-decision-1:requested',
            schema_version: 'mct-observation/v1',
            kind: 'decision.requested',
            source: 'mindcraft',
            agent_id: 'MCT_A',
            origin: 'controller',
            payload: { source: 'system' }
        });
        const [recorded] = await eventPromise;
        assert.equal(recorded.id, 'MCT_A-decision-1:requested');
        assert.equal(recorded.run_id, process.env.MCT_RUN_ID);

        const eventsPath = getTelemetryStore().eventsPath;
        const lines = readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean);
        assert.equal(lines.length, 1);
        const snapshot = await (await fetch('http://localhost:18124/mct/observability/snapshot?after=0')).json();
        assert.equal(snapshot.events.length, 1);
        assert.equal(snapshot.events[0].id, 'MCT_A-decision-1:requested');
        const staleCursor = await (await fetch('http://localhost:18124/mct/observability/snapshot?after=999&run_id=previous-run')).json();
        assert.equal(staleCursor.reset, true);
        assert.equal(staleCursor.events.length, 1, 'new run must ignore previous run high cursor');
        assert.equal(staleCursor.run_id, process.env.MCT_RUN_ID);
        const delta = await (await fetch(`http://localhost:18124/mct/observability/snapshot?after=1&run_id=${process.env.MCT_RUN_ID}`)).json();
        assert.equal(delta.reset, false);
        assert.equal(delta.events.length, 0, 'same-run polling must not repeat already seen events');
        console.log(JSON.stringify({ ok: true, runId: process.env.MCT_RUN_ID, events: lines.length }));
    } finally {
        client.close();
        await new Promise(resolve => server.close(resolve));
        rmSync(getTelemetryStore().dir, { recursive: true, force: true });
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
