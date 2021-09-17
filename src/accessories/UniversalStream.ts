import net from 'net'
import fs from 'fs'
import os from 'os'

let counter = 0

export class NamePipeStream {
    private server;
    private sock_id;

    public url;

    constructor(stream, onSocket) {
        let path

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
        this.server = net.createServer(onSocket)
        stream.on('finish', () => {
            this.server.close()
        })
        this.server.listen(path)
    }
    close() {
        if (this.server)
            this.server.close();
    }
}

export function StreamInput(stream) {
    return new NamePipeStream(stream, socket => stream.pipe(socket))
}

export function StreamOutput(stream) {
    return new NamePipeStream(stream, socket => socket.pipe(stream))
}
