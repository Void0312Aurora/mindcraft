import assert from 'node:assert/strict';
import { runtimeEnvironment } from './runtime-config.mjs';

const observatory = runtimeEnvironment('observatory');
const journey = runtimeEnvironment('journey');
assert.equal(observatory.minecraft.port, 25586);
assert.equal(observatory.mindserver.port, 8080);
assert.equal(journey.minecraft.port, 25585);
assert.equal(journey.mindserver.port, 8086);
assert.notEqual(observatory.minecraft.port, journey.minecraft.port);
assert.notEqual(observatory.mindserver.port, journey.mindserver.port);
process.env.MCT_MINECRAFT_PORT = '26086';
process.env.MCT_MINDSERVER_PORT = '28080';
const overridden = runtimeEnvironment('observatory');
assert.equal(overridden.minecraft.port, 26086);
assert.equal(overridden.mindserver.url, 'http://127.0.0.1:28080');
delete process.env.MCT_MINECRAFT_PORT;
delete process.env.MCT_MINDSERVER_PORT;
console.log(JSON.stringify({ ok: true, environments: ['observatory', 'journey'], overrides: true }));
