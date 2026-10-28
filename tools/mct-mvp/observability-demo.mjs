import express from 'express';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { Server } from 'socket.io';
import { RunRecorder } from './observability-recorder.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.MCT_OBSERVABILITY_PORT || 8090);
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const recorder = new RunRecorder({
    root: resolve(root, 'run/evidence'),
    metadata: {
        kind: 'script-agent-observability-demo',
        world: 'ordinary-minecraft-placeholder',
        agents: ['MCT_A', 'MCT_B', 'MCT_C'],
        route: { start: { x: 0, z: 0 }, destination: { x: 100, z: 70 } }
    }
});

app.get('/', (_req, res) => res.type('html').send(readFileSync(resolve(root, 'tools/mct-mvp/observability-demo.html'), 'utf8')));
app.get('/api/snapshot', (_req, res) => res.json(recorder.getSnapshot()));

const colors = { MCT_A: '#5eead4', MCT_B: '#fbbf24', MCT_C: '#c4b5fd' };
const waypoints = {
    MCT_A: [[0, 0], [18, 12], [42, 28], [68, 50], [100, 70]],
    MCT_B: [[0, 2], [20, 18], [42, 28], [75, 54], [100, 70]],
    MCT_C: [[2, -2], [24, 8], [42, 28], [65, 47], [100, 70]]
};

class ScriptAgent {
    constructor(name) {
        this.name = name;
        this.color = colors[name];
        this.route = waypoints[name];
        this.segment = 0;
        this.position = { x: this.route[0][0], y: 64, z: this.route[0][1] };
        this.health = 20;
        this.hunger = 20;
        this.saturation = 5;
        this.currentAction = 'Preparing route';
        this.gameTick = 0;
        this.decisionCount = 0;
        this.arrived = false;
    }

    state() {
        return {
            gameTick: this.gameTick,
            position: { ...this.position },
            health: this.health,
            hunger: this.hunger,
            saturation: this.saturation,
            action: this.currentAction,
            color: this.color
        };
    }

    emitState() {
        recorder.recordState(this.name, this.state());
    }

    message(to, text) {
        recorder.record('message', this.name, { to, message: text, gameTick: this.gameTick });
    }

    decide(trigger, output, command) {
        const decisionId = `${this.name.toLowerCase()}-d${++this.decisionCount}`;
        recorder.record('decision', this.name, {
            gameTick: this.gameTick,
            trigger,
            observation: this.state(),
            output,
            command
        }, { decisionId });
        return decisionId;
    }

    action(decisionId, label, result = 'completed') {
        const actionId = `${this.name.toLowerCase()}-a${this.gameTick}`;
        recorder.record('action', this.name, {
            gameTick: this.gameTick,
            label,
            phase: 'started'
        }, { decisionId, actionId });
        recorder.record('action', this.name, {
            gameTick: this.gameTick,
            label,
            phase: result,
            result: result === 'completed' ? 'route segment advanced' : result
        }, { decisionId, actionId });
    }

    step(step) {
        this.gameTick += 10;
        if (step === 2) {
            const decisionId = this.decide('队伍开始移动', '沿着较安全的低地前进，保持三人可见。', 'follow-low-ground');
            this.action(decisionId, 'follow-low-ground');
        }
        if (step === 6 && this.name === 'MCT_A') this.message('MCT_B', '前方低地可通行，保持队形。');
        if (step === 8 && this.name === 'MCT_B') this.message('MCT_A', '收到，正在靠拢。');
        if (step === 12 && this.name === 'MCT_C') {
            const decisionId = this.decide('发现前方水面', '绕开水面，代价是暂时偏离主路线。', 'detour-around-water');
            this.action(decisionId, 'detour-around-water');
        }
        if (step === 16 && this.name === 'MCT_A') recorder.record('world', null, { gameTick: this.gameTick, event: 'sunset', note: '夜间风险开始' });
        if (step === 18 && this.name === 'MCT_B') {
            const decisionId = this.decide('天色变暗且饥饿下降', '先停下来合并队伍，再决定是否寻找食物。', 'regroup-and-check-food');
            this.action(decisionId, 'regroup-and-check-food');
        }
        if (step === 20 && this.name === 'MCT_C') this.message('MCT_A', '我有余粮，可以共享。');
        if (step > 18) this.hunger = Math.max(8, this.hunger - 0.25);
        if (step === 24 && this.name === 'MCT_A') {
            this.hunger = 20;
            recorder.record('world', this.name, { gameTick: this.gameTick, event: 'food-consumed', item: 'bread', hunger: this.hunger });
        }
        if (step === 26 && this.name === 'MCT_A') this.message('MCT_C', '食物已补充，继续前进。');
        if (step === 30 && this.name === 'MCT_C') {
            const decisionId = this.decide('队伍重新会合', '夜间保持靠近，天亮后继续前往 B。', 'hold-together');
            this.action(decisionId, 'hold-together');
        }
        this.moveTowardNextWaypoint();
        this.emitState();
        if (this.arrived && step === 42) {
            recorder.record('world', this.name, { gameTick: this.gameTick, event: 'arrived', destination: 'B' });
        }
    }

    moveTowardNextWaypoint() {
        if (this.arrived) return;
        const target = this.route[this.segment + 1];
        const dx = target[0] - this.position.x;
        const dz = target[1] - this.position.z;
        const distance = Math.hypot(dx, dz);
        const speed = 2.4;
        if (distance <= speed) {
            this.position.x = target[0];
            this.position.z = target[1];
            this.segment++;
            if (this.segment >= this.route.length - 1) {
                this.arrived = true;
                this.currentAction = 'Arrived at B';
            }
        } else {
            this.position.x += dx / distance * speed;
            this.position.z += dz / distance * speed;
            this.currentAction = 'Walking';
        }
    }
}

const agents = Object.fromEntries(['MCT_A', 'MCT_B', 'MCT_C'].map(name => [name, new ScriptAgent(name)]));
let step = 0;
let timer = null;
let completed = false;

function broadcast(event, snapshot) {
    io.emit('observability-event', event);
    io.emit('observability-snapshot', snapshot);
}

recorder.subscribe((event, snapshot) => broadcast(event, snapshot));

function advance() {
    if (recorder.run.status !== 'running') return;
    step++;
    for (const agent of Object.values(agents)) agent.step(step);
    if (step === 34) recorder.record('world', null, { gameTick: step * 10, event: 'sunrise', note: '可以重新规划路线' });
    if (!completed && Object.values(agents).every(agent => agent.arrived)) {
        completed = true;
        recorder.record('world', null, { gameTick: step * 10, event: 'all-arrived', result: 'all agents reached B' });
        clearInterval(timer);
    }
}

function control(action) {
    if (action === 'pause' && recorder.run.status === 'running') {
        recorder.setStatus('pausing');
        recorder.setStatus('paused', { note: 'script agents and demo world stopped at barrier' });
    } else if (action === 'resume' && recorder.run.status === 'paused') {
        recorder.setStatus('resuming');
        recorder.setStatus('running');
    }
}

io.on('connection', socket => {
    socket.emit('observability-snapshot', recorder.getSnapshot());
    socket.on('control-run', control);
});

app.get('/health', (_req, res) => res.json({ ok: true, runId: recorder.run.runId, status: recorder.run.status }));
server.listen(port, '127.0.0.1', () => {
    console.log(`Script-agent observability demo: http://127.0.0.1:${port}`);
    console.log(`Evidence: ${recorder.eventsPath}`);
});
timer = setInterval(advance, 500);

function shutdown() {
    recorder.finish({ result: 'demo process stopped' });
    clearInterval(timer);
    server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
