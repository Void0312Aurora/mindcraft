import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.MCT_TELEMETRY = '1';
process.env.MCT_STATE_REQUEST_TIMEOUT_MS = '100';
const { createMindServer, registerAgent, collectAgentStatesForTest, getTelemetryStore } =
    await import('../../src/mindcraft/mindserver.js');
const server = createMindServer(false, 18125);
await once(server, 'listening');
const connection = registerAgent({ profile: { name: 'MCT_TIMEOUT' } }, 0);
connection.in_game = true;
connection.socket = { disconnected: false, emit() { /* never calls back */ } };
try {
    const started = Date.now();
    const states = await collectAgentStatesForTest();
    const elapsed = Date.now() - started;
    assert.equal(states.MCT_TIMEOUT.error, 'timeout');
    assert.ok(elapsed < 1000, `state request exceeded bounded wait: ${elapsed}ms`);
    const snapshot = getTelemetryStore().snapshot();
    assert.ok(snapshot.events.some(event => event.kind === 'agent.state_request_timeout'));
    connection.socket = {
        disconnected: false,
        emit(name, callback) {
            assert.equal(name, 'get-full-state');
            callback({ gameplay: { position: { x: 1, y: 65, z: 2 }, health: 18, hunger: 7, worldTick: 1234, timeOfDay: 9000 }, action: { current: 'Thinking', kind: 'thinking' } });
        }
    };
    const recovered = await collectAgentStatesForTest();
    assert.equal(recovered.MCT_TIMEOUT.gameplay.worldTick, 1234);
    assert.equal(recovered.MCT_TIMEOUT.action.current, 'Thinking');
    console.log(JSON.stringify({ ok: true, elapsed_ms: elapsed, error: states.MCT_TIMEOUT.error }));
} finally {
    await new Promise(resolve => server.close(resolve));
}
