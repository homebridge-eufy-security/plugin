import net from 'net'
import fs from 'fs'
import os from 'os'
import { Readable } from 'stream';

let counter = 0

export class NamePipeStream {
    private server;
    private sock_id;
    private log;
    private who;
    public url;
    private stream: Readable;

    constructor(stream, onSocket, who, log) {
        this.log = log;
        this.stream = stream;
        this.who = who;
        let path;

        this.sock_id = ++counter

        const osType = os.type()
        if (osType === 'Windows_NT') {
            path = '\\\\.\\pipe\\stream' + (++counter)
            this.url = path
        } else {
            path = './' + (++counter) + '.sock'
            this.url = 'unix:' + path
        }

        try {
            fs.statSync(path)
            fs.unlinkSync(path)
        } catch (err) { }

        this.server = net.createServer(onSocket);

        this.stream.on('finish', () => {
            this.server.close();
        });

        this.server.on('error', (err: Error) => {
            this.log.error(this.who, 'Error in NamePipe', err?.message, err?.stack);
        });

        this.server.listen(path);
    }
    
    close() {
        if (this.server) {
            this.log.debug(this.who, 'Closed NamePipeStream');
            this.stream.unpipe();
            this.server.close();
        } else {
            this.log.error(this.who, 'NamePipeStream did exist?');
        }
    }
}

export function StreamInput(stream, who, log) {
    return new NamePipeStream(stream, socket => stream.pipe(socket), who, log)
}

export function StreamOutput(stream, who, log) {
    return new NamePipeStream(stream, socket => socket.pipe(stream), who, log)
}