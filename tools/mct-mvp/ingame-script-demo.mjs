import { RunRecorder } from './observability-recorder.mjs';
import { InGameObservabilityRenderer } from './ingame-observability-renderer.mjs';

const renderer = new InGameObservabilityRenderer({
    host: process.env.MCT_MC_HOST || '127.0.0.1',
    port: Number(process.env.MCT_RCON_PORT || 25575),
    password: process.env.MCT_RCON_PASSWORD || 'mct-observability'
});
const recorder = new RunRecorder({
    root: 'run/evidence',
    metadata: {
        kind: 'script-agent-ingame-demo',
        world: 'ordinary-minecraft',
        agents: ['MCT_A', 'MCT_B', 'MCT_C'],
        route: { start: { x: 0, y: 65, z: 0 }, destination: { x: 100, y: 65, z: 70 } }
    }
});

const agents = [
    { name: 'MCT_A', colorName: 'aqua', rgb: [0.1, 0.9, 0.85], block: 'cyan_concrete', route: [[0, 0], [20, 12], [45, 30], [72, 52], [100, 70]], x: 0, z: 0, hunger: 20, action: '准备出发' },
    { name: 'MCT_B', colorName: 'gold', rgb: [1, 0.65, 0.05], block: 'yellow_concrete', route: [[0, 2], [18, 20], [45, 30], [75, 54], [100, 70]], x: 0, z: 2, hunger: 20, action: '准备出发' },
    { name: 'MCT_C', colorName: 'light_purple', rgb: [0.75, 0.45, 1], block: 'purple_concrete', route: [[2, -2], [24, 8], [45, 30], [66, 48], [100, 70]], x: 2, z: -2, hunger: 20, action: '准备出发' }
];
for (const agent of agents) { agent.segment = 0; agent.health = 20; agent.gameTick = 0; agent.decisionCount = 0; agent.arrived = false; }

let step = 0;
let paused = false;
let timer = null;
let advancing = false;
let completed = false;

function stateOf(agent) {
    return { gameTick: agent.gameTick, position: { x: agent.x, y: 65, z: agent.z }, health: agent.health, hunger: agent.hunger, action: agent.action };
}

async function decision(agent, trigger, output, command) {
    const decisionId = `${agent.name.toLowerCase()}-d${++agent.decisionCount}`;
    recorder.record('decision', agent.name, { gameTick: agent.gameTick, trigger, observation: stateOf(agent), output, command }, { decisionId });
    await renderer.decision(agent, { x: agent.x, z: agent.z }, output, command);
}

function move(agent) {
    if (agent.arrived) return;
    const target = agent.route[agent.segment + 1];
    const dx = target[0] - agent.x;
    const dz = target[1] - agent.z;
    const distance = Math.hypot(dx, dz);
    const speed = 2.1;
    if (distance <= speed) {
        agent.x = target[0]; agent.z = target[1]; agent.segment++;
        if (agent.segment >= agent.route.length - 1) { agent.arrived = true; agent.action = '已抵达 B'; }
    } else {
        agent.x += dx / distance * speed; agent.z += dz / distance * speed; agent.action = '行进中';
    }
}

async function advance() {
    if (paused || advancing || completed) return;
    advancing = true;
    try {
    step++;
    for (const agent of agents) {
        agent.gameTick += 10;
        if (step === 3) await decision(agent, '队伍开始移动', '沿低地前进，保持三人可见。', 'follow-low-ground');
        if (step === 11 && agent.name === 'MCT_C') await decision(agent, '发现水面', '绕开水面，暂时偏离主路线。', 'detour-around-water');
        if (step > 15) agent.hunger = Math.max(8, agent.hunger - 0.3);
        if (step === 20 && agent.name === 'MCT_A') {
            agent.hunger = 20;
            recorder.record('world', agent.name, { gameTick: agent.gameTick, event: 'food-consumed', item: 'bread', hunger: agent.hunger });
            await renderer.worldEvent('MCT_A 进食：bread', 'aqua');
        }
        move(agent);
        recorder.recordState(agent.name, stateOf(agent));
        await renderer.drawState(agent, stateOf(agent), step === 1 || step % 4 === 0 || agent.arrived);
    }
    if (step === 15) {
        recorder.record('world', null, { gameTick: step * 10, event: 'sunset' });
        await renderer.worldEvent('日落 · 夜间风险开始', 'yellow');
    }
    if (step === 28) {
        recorder.record('world', null, { gameTick: step * 10, event: 'sunrise' });
        await renderer.worldEvent('天亮 · 重新规划路线', 'green');
    }
    if (agents.every(agent => agent.arrived)) {
        completed = true;
        recorder.record('world', null, { gameTick: step * 10, event: 'all-arrived', result: 'all agents reached B' });
        clearInterval(timer);
        console.log('All script agents reached B. Press q to exit and clean the arena.');
    }
    } finally {
        advancing = false;
    }
}

async function setPaused(value) {
    if (value === paused) return;
    paused = value;
    recorder.setStatus(value ? 'pausing' : 'resuming');
    if (value) {
        recorder.setStatus('paused');
        await renderer.pause();
    } else {
        recorder.setStatus('running');
        await renderer.resume();
    }
}

async function main() {
    console.log('Connecting the in-game renderer to ordinary Minecraft RCON...');
    await renderer.connect();
    await renderer.setupArena();
    for (const agent of agents) await renderer.drawState(agent, stateOf(agent));
    timer = setInterval(() => { advance().catch(error => { console.error(error); process.exitCode = 1; }); }, 800);
    console.log('In-game demo ready. Terminal controls: p = pause, r = resume, q = quit.');
}

if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', async key => {
        const input = key.toString().toLowerCase();
        if (input === 'p') await setPaused(true);
        if (input === 'r') await setPaused(false);
        if (input === 'q' || input === '\u0003') await shutdown();
    });
}

async function shutdown() {
    clearInterval(timer);
    recorder.finish({ result: 'demo stopped by operator' });
    await renderer.cleanup();
    process.exit(0);
}
process.on('SIGINT', () => { shutdown().catch(error => { console.error(error); process.exit(1); }); });
process.on('SIGTERM', () => { shutdown().catch(error => { console.error(error); process.exit(1); }); });

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
