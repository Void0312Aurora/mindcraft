import { RconClient } from './rcon-client.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function quoteText(text, color = 'white') {
    const value = JSON.stringify({ text: String(text), color, bold: true });
    return `'${value.replaceAll("'", "\\'")}'`;
}

export class InGameObservabilityRenderer {
    constructor({ host = '127.0.0.1', port = 25575, password = 'mct-observability', commandDelayMs = 30 } = {}) {
        this.options = { host, port, password };
        this.rcon = null;
        this.commandDelayMs = commandDelayMs;
        this.commandQueue = Promise.resolve();
    }

    async connect() {
        this.rcon = new RconClient(this.options);
        await this.rcon.connect();
    }

    command(command) {
        this.commandQueue = this.commandQueue.then(async () => {
            if (!this.rcon) throw new Error('RCON renderer is not connected');
            await this.rcon.command(command);
            await wait(this.commandDelayMs);
        });
        return this.commandQueue;
    }

    async setupArena() {
        await this.command('gamerule sendCommandFeedback false');
        await this.command('gamerule doDaylightCycle false');
        await this.command('gamerule doMobSpawning false');
        await this.command('kill @e[tag=mct_demo]');
        // Flatten only the isolated demo rectangle so trail blocks and text are
        // not buried by the ordinary world's terrain.
        for (let z = -10; z < 80; z += 10) {
            await this.command(`fill -10 65 ${z} 120 75 ${z + 9} minecraft:air`);
            await this.command(`fill -10 76 ${z} 120 90 ${z + 9} minecraft:air`);
        }
        await this.command('fill -10 63 -10 120 63 80 minecraft:stone');
        await this.command('fill -10 64 -10 120 64 80 minecraft:grass_block');
        await this.command('gamemode spectator MCT_Observer');
        await this.command('tp MCT_Observer 50 82 105');
        await this.marker('A', 0, 65, 0, 'white');
        await this.marker('B', 100, 65, 70, 'gold');
        await this.board('MCT OBSERVABILITY\nSCRIPT AGENT DEMO\n轨迹、决策、动作结果', 45, 74, -4, 'aqua', 'mct_board');
    }

    async marker(text, x, y, z, color) {
        return this.command(`summon minecraft:text_display ${x} ${y} ${z} {Tags:["mct_demo","mct_marker"],text:${quoteText(text, color)},billboard:"center",background:1073741824,shadow:1b,see_through:1b}`);
    }

    async board(text, x, y, z, color, tag) {
        await this.command(`kill @e[tag=${tag}]`);
        const lines = String(text).split('\n');
        for (let i = 0; i < lines.length; i++) {
            await this.command(`summon minecraft:text_display ${x} ${y - i * 0.35} ${z} {Tags:["mct_demo","${tag}"],text:${quoteText(lines[i], color)},billboard:"center",background:1073741824,shadow:1b,see_through:1b,line_width:240}`);
        }
    }

    async drawState(agent, state, showLabel = false) {
        const { x, y, z } = state.position;
        const color = agent.colorName;
        const block = agent.block;
        await this.command(`setblock ${Math.round(x)} 65 ${Math.round(z)} minecraft:${block} replace`);
        await this.command(`particle dust ${agent.rgb.join(' ')} 1 ${x} 65.2 ${z} 0 0 0 0 1 force`);
        if (showLabel) {
            await this.board(`${agent.name}\n生命 ${Math.round(state.health)}  食物 ${Math.round(state.hunger)}\n${state.action}`, x, 68, z, color, `mct_label_${agent.name}`);
        }
    }

    async decision(agent, position, text, command) {
        const { x, z } = position;
        await this.board(`${agent.name}\n决定：${text}\n命令：${command}`, x, 70, z, agent.colorName, `mct_decision_${agent.name}_${Date.now()}`);
        await this.command(`tellraw @a {"text":"[${agent.name}] ${text} -> ${command}","color":"${agent.colorName}"}`);
    }

    async worldEvent(text, color = 'yellow') {
        await this.board(text, 45, 76, 2, color, 'mct_world_event');
        await this.command(`title @a actionbar {"text":"${text}","color":"${color}"}`);
    }

    async pause() {
        await this.worldEvent('PAUSED · 观测状态冻结', 'red');
    }

    async resume() {
        await this.worldEvent('RESUMED · 继续记录', 'green');
    }

    async cleanup() {
        if (!this.bot) return;
        await this.command('kill @e[tag=mct_demo]');
        this.rcon.close();
        this.rcon = null;
    }
}
