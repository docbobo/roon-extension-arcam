'use strict';

const net = require('net'),
      EventEmitter = require('events'),
      Promise = require('bluebird');

class Connection extends EventEmitter {

    get host() {
        return this._host;
    }

    get port() {
        return this._port;
    }

    get socket() {
        return this._socket;
    }

    constructor(host, port = 50000) {
        super();

        this._host = host;
        this._port = port;

        this.initializeSocket();
    }

    initializeSocket() {
        this._socket = new net.Socket();

        this.socket.on('data', (data) => {
            this.emit('data', data);
        });

        this.socket.on('close', () => {
            this.emit('close');
        });

        this.socket.on('error', (error) => {
            this.emit('error', error);
        });

        this.socket.on('connect', () => {
            this.emit('connect');
        });
    }

    write(command) {
        return new Promise((resolve) => {
            this.socket.write(command, 'buffer', resolve);
        });
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.initializeSocket();

            this.socket.once('connect', () => {
                resolve();
                this.socket.removeListener('error', reject);
            });

            this.socket.once('error', (error) => {
                reject(error);

                this.socket.removeListener('connect', resolve);
            });

            this.socket.connect(this.port, this.host);
        });
    }

    disconnect() {
        this.socket.end();
    }
}

module.exports = Connection;
