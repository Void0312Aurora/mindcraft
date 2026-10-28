import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const configPath = resolve(root, 'config/mct-mvp/runtime.json');
const definition = JSON.parse(readFileSync(configPath, 'utf8'));

function numberOverride(value, fallback) {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid numeric runtime override: ${value}`);
    return parsed;
}

export function runtimeEnvironment(name = process.env.MCT_RUNTIME_PROFILE || definition.default_environment) {
    const selected = definition.environments[name];
    if (!selected) throw new Error(`Unknown MCT runtime profile '${name}'. Use: ${Object.keys(definition.environments).join(', ')}`);
    const environment = structuredClone(selected);
    environment.name = name;
    environment.minecraft.host = process.env.MCT_MINECRAFT_HOST || environment.minecraft.host;
    environment.minecraft.port = numberOverride(process.env.MCT_MINECRAFT_PORT, environment.minecraft.port);
    environment.minecraft.version = process.env.MCT_MINECRAFT_VERSION || environment.minecraft.version;
    environment.minecraft.server = process.env.MCT_SERVER_NAME || environment.minecraft.server;
    environment.mindserver.host = process.env.MCT_MINDSERVER_HOST || environment.mindserver.host;
    environment.mindserver.port = numberOverride(process.env.MCT_MINDSERVER_PORT, environment.mindserver.port);
    environment.mindserver.url = `http://${environment.mindserver.host}:${environment.mindserver.port}`;
    return environment;
}

export function runtimeConfigPath() { return configPath; }
