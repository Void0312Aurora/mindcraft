import { performance } from 'node:perf_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TelemetryStore } from '../../src/mindcraft/telemetry_store.js';

const results = [];
for (const agentCount of [1, 3]) {
    const root = mkdtempSync(join(tmpdir(), `mct-telemetry-${agentCount}-`));
    try {
        const store = new TelemetryStore({ enabled: true, root, runId: `perf-${agentCount}` });
        const total = agentCount * 1000;
        const started = performance.now();
        for (let i = 0; i < total; i++) {
            store.record({
                kind: 'agent.position_sample', agent_id: `MCT_${String.fromCharCode(65 + (i % agentCount))}`,
                source: 'minecraft', origin: 'minecraft',
                payload: { position: { x: i % 100, y: 65, z: i % 80 }, health: 20, hunger: 20 }
            });
        }
        const elapsed = performance.now() - started;
        results.push({ agents: agentCount, events: total, elapsed_ms: Number(elapsed.toFixed(2)), events_per_second: Math.round(total / (elapsed / 1000)) });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}
console.log(JSON.stringify({ ok: true, mode: 'synthetic_sync_append_bound', results }));
