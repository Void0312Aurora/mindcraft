import net from 'node:net';

const TYPE_COMMAND = 2;
const TYPE_AUTH = 3;

function packet(id, type, body) {
    const payload = Buffer.from(`${body}\0\0`, 'utf8');
    const out = Buffer.alloc(4 + 4 + 4 + payload.length);
    out.writeInt32LE(4 + 4 + payload.length, 0);
    out.writeInt32LE(id, 4);
    out.writeInt32LE(type, 8);
    payload.copy(out, 12);
    return out;
}

export class RconClient {
    constructor({ host = '127.0.0.1', port = 25575, password }) {
        this.host = host;
        this.port = port;
        this.password = password;
        this.socket = null;
        this.buffer = Buffer.alloc(0);
        this.pending = new Map();
        this.nextId = 1;
    }

    async connect() {
        this.socket = net.createConnection({ host: this.host, port: this.port });
        this.socket.on('data', chunk => this.consume(chunk));
        this.socket.on('error', error => {
            for (const pending of this.pending.values()) pending.reject(error);
            this.pending.clear();
        });
        await new Promise((resolve, reject) => {
            this.socket.once('connect', resolve);
            this.socket.once('error', reject);
        });
        const auth = await this.request(TYPE_AUTH, this.password);
        if (auth.id === -1) throw new Error('RCON authentication failed');
    }

    request(type, body) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.socket.write(packet(id, type, body));
        });
    }

    async command(command) {
        return this.request(TYPE_COMMAND, command);
    }

    consume(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.buffer.length >= 4) {
            const length = this.buffer.readInt32LE(0);
            if (length < 10 || this.buffer.length < 4 + length) return;
            const body = this.buffer.subarray(4, 4 + length);
            this.buffer = this.buffer.subarray(4 + length);
            const id = body.readInt32LE(0);
            const type = body.readInt32LE(4);
            const response = { id, type, body: body.subarray(8, length - 2).toString('utf8') };
            const pending = this.pending.get(id);
            if (pending) {
                this.pending.delete(id);
                pending.resolve(response);
            }
        }
    }

    close() {
        this.socket?.end();
        this.socket = null;
    }
}
