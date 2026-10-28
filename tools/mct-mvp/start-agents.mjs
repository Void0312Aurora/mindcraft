import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runtimeEnvironment } from './runtime-config.mjs';

process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const modelPath = 'config/mct-mvp/model.local.json';
if (!existsSync(modelPath)) throw new Error('Configure model.local.json from the example before starting agents. This command makes model requests.');
const model = read(modelPath);
if (!model.model?.model || /REPLACE|CHOSEN/.test(model.model.model)) throw new Error('Choose a real model first.');
if (!model.embedding?.model || /REPLACE|CHOSEN/.test(model.embedding.model)) throw new Error('Configure the embedding model and its provider explicitly; Mindcraft initializes skill embeddings on startup.');
const scenario = read('config/mct-mvp/scenario.json');
const runtime = runtimeEnvironment(process.env.MCT_RUNTIME_PROFILE || 'journey');
if (!scenario.route.start || !scenario.route.destination) throw new Error('Survey and set A/B before starting the journey.');
if (!['allow-sleep', 'full-night'].includes(scenario.sleepPolicy)) throw new Error('Choose sleepPolicy: allow-sleep or full-night.');
for (const point of [scenario.route.start, scenario.route.destination]) {
    if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error('A/B must have numeric x/y/z coordinates.');
}
const settings = read('config/mct-mvp/agents.settings.json');
settings.host = runtime.minecraft.host;
settings.port = runtime.minecraft.port;
settings.minecraft_version = runtime.minecraft.version;
settings.mindserver_port = runtime.mindserver.port;
mkdirSync('run/agent-profiles', { recursive: true });
settings.profiles = scenario.agents.map(name => {
    const path = `run/agent-profiles/${name}.json`;
    writeFileSync(path, JSON.stringify({ name, ...model }, null, 2));
    return path;
});
const goal = `你与 ${scenario.agents.join('、')} 一起旅行，从 A ${JSON.stringify(scenario.route.start)} 前往 B ${JSON.stringify(scenario.route.destination)}。目标是全员存活抵达，途中至少度过一个夜晚。自行决定路线、补给、休息和互助，不预设职业。需要食物时自行获取、进食或商量分享。睡眠规则：${scenario.sleepPolicy === 'full-night' ? '本轮不得使用床跳过夜晚' : '允许自行获得床并睡觉跳夜'}。请用中文交流，并使用现有命令持续推进共同目标。`;
settings.init_message = null;
writeFileSync('run/mission-commands.txt', scenario.agents.map(name => `/tell ${name} !goal(${JSON.stringify(goal)})`).join('\n') + '\n');
console.log('Starting three Mindcraft agents. Model API requests, including initialization embeddings, are enabled. Prepare spawn/inventory first, then issue run/mission-commands.txt to begin the journey.');
const child = spawn(process.execPath, ['main.js'], { stdio: 'inherit', env: { ...process.env, SETTINGS_JSON: JSON.stringify(settings) } });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
