// Shared setup for the live checks: the test pad at (190..214, 150, 190..214)
// is far from spawn, so its chunks are only loaded once a player is there.
// `fill` on an unloaded chunk fails ("That position is not loaded") and the
// bot then falls into the void. Force-load the area before building.
export async function preparePad(rcon, floor = 'stone') {
    const c = x => rcon.command(x);
    await c('forceload add 190 190 214 214');
    for (let i = 0; i < 20; i++) {
        const r = await c(`fill 190 150 190 214 160 214 air`);
        if (!/not loaded/.test(r.body)) break;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    await c(`fill 190 150 190 214 150 214 ${floor}`);
}
export async function releasePad(rcon) {
    await rcon.command('fill 190 151 190 214 160 214 air');
    await rcon.command('forceload remove 190 190 214 214');
}
