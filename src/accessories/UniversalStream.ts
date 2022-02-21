import net from 'net'
import fs from 'fs'
import os from 'os'
import { Readable } from 'stream';
import { Logger } from './logger';
let counter = 0

export class NamePipeStream {
    private server;
    private sock_id;
    private log;
    private who;
    public url;
    private stream: Readable;
    private storagePath: string;

    constructor(stream: Readable, who: string, storagePath: string, log: Logger) {
        this.log = log;
        this.stream = stream;
        this.who = who;
        this.storagePath = storagePath;
        let path;

        var writableStream = this.createWriteable(stream);

        this.sock_id = ++counter

        const osType = os.type()
        if (osType === 'Windows_NT') {
            path = '\\\\.\\pipe\\stream' + (++counter)
            this.url = path
        } else {
            path = this.storagePath + '/' + (++counter) + '.sock'
            this.url = 'unix:' + path
            this.log.debug('current_path', path);
            this.log.debug('parent_dir',__dirname);
        }

        try {
            fs.statSync(path)
            fs.unlinkSync(path)
        } catch (err) { }

        this.server = net.createServer(writableStream);

        this.stream.on('finish', () => {
            this.server.close();
        });

        this.stream.on('error', (err) => {
            this.log.error(err);
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

    createWriteable(stream){
        return (writableStream) => stream.pipe(writableStream).on('error', (err) => {
            if(err.code === 'ECONNRESET'){
                this.log.info('Connection closed by Eufy station.')
            }
            else
            {
                this.log.error(err);
            }
            this.log.info('ErrorCode ' +err.code);
            this.close();
        });      
    }
}

export function StreamInput(stream: Readable, who: string, storagePath: string, log: Logger) {
    return new NamePipeStream(stream, who, storagePath, log);
}