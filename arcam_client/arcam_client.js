'use strict';

const debug        = require('debug')('roon-extension-arcam:client'),
      _            = require('lodash'),
      Promise      = require('bluebird'),
      Connection   = require('./connection'),
      Options      = require('./options'),
      Buffer       = require('buffer').Buffer;

/**
 * The Arcam AVR RPC class.
 *
 * @class ArcamClient
 * @extends Connection
 */
class ArcamClient extends Connection {

    constructor(host, port = 50000) {
        super(host, port);

        this.commandTable = {
            'heartbeat': {
                commandCode: Options.HeartbeatOptions.Command,
                /**
                 * @event heartbeat
                */
                emit: 'heartbeat'
            },
            'masterVolume': {
                commandCode: Options.VolumeOptions.Command,
                /**
                 * @event masterVolumeChanged
                 * @param {object} volume The current volume
                 */
                emit: 'masterVolumeChanged'
            },
            'mute': {
                commandCode: Options.MuteOptions.Command,
                /**
                 * @event muteChanged
                 * @param {MuteOptions} mute The current mute status
                 */
                emit: 'muteChanged'
            }
        };

        this.on('data', (data) => {
            this._onData(data);
        });

        this.on('error', (error) => {});
    }

    /**
     * Receives the incoming data.
     *
     * @method _onData
     * @private
     * @param  {Buffer} data The incoming data
     */
    _onData(data) {
        if (typeof data === 'object') {
            const buffer = Buffer.from(data);
            debug("Received message: %O", buffer.toString('hex'));

            const st = buffer.readUInt8(0);
            if (st != 0x21) {
                // If the message doesn't start with the magic 0x21, let's ignore it.
                return;
            }

            const zn = buffer.readUInt8(1);
            const cc = buffer.readUInt8(2);
            const ac = buffer.readUInt8(3);
            if (ac != 0x00) {
                return;
            }

            const dl = buffer.readUInt8(4);
            const et = buffer.readUInt8(5 + dl);
            if (et != 0x0d) {
                // If the message doesn't end with the end marker, let's ignore it.
                return;
            }

            const results = this._applyCommandMapping(cc, zn, buffer.slice(5, 5 + dl));
            results.forEach((result) => {
                this.emit(result.emit, result.value);
            });
        }
    }

    getEvent(key) {
        if (typeof this.commandTable[key] !== 'undefined') {
            return this.commandTable[key].emit;
        } else {
            return undefined;
        }
    }

    _applyCommandMapping(cc, zn, data) {
        const keys = _(this.commandTable).keys();
        const matches = [];

        _(keys).each((key) => {
            const handler = this.commandTable[key];

            if (handler.commandCode === cc) {
                const matchResult = handler;
                matchResult.zone = zn;

                // If the event hook has a transform method call it before applying the result value
                if (matchResult.transform) {
                    matchResult.value = matchResult.transform(data);
                } else {
                    matchResult.value = data.readUInt8(0);
                }

                matches.push(matchResult);
            }
        });

        return matches;
    }

    sendCommand(cc, parameter, hook) {
        return new Promise((resolve) => {
            if (typeof hook === 'string') {
                this.once(hook, (result) => {
                    resolve(result);
                });
            }

            var parameters;
            if (parameter == null) {
                parameters = [];
            } else {
                parameters = Array.isArray(parameter) ? parameter : [ parameter ];
            }

            const buffer = Buffer.alloc(5 + parameters.length);
            buffer.writeUInt8(0x21, 0);        // Magic
            buffer.writeUInt8(0x01, 1);        // Zone
            buffer.writeUInt8(cc, 2);
            buffer.writeUInt8(parameters.length, 3);
            var i = 0;
            for(i = 0; i < parameters.length; i++) {
                buffer.writeUInt8(parameters[i], 4 + i);
            }
            buffer.writeUInt8(0x0d, 4 + i);

            debug("Sending Command: %O", buffer.toString('hex'));

            return this
                .write(buffer)
                .then(() => {
                    if (typeof hook === 'undefined') {
                        resolve();
                    }
                });
        })
    }

    setVolume(volumeOptions) {
        return this.sendCommand(0x0d, volumeOptions);
    }

    /**
      * Request the volume of a zone. This command returns the volume even if the zone requested is in mute.
      *
      * @method getVolume
      * @return {Promise} [A response]
      */
    getVolume() {
        return this.sendCommand(Options.VolumeOptions.Command, Options.VolumeOptions.Status, this.getEvent('masterVolume'));
    }

    setMute(mute) {
        return this.sendCommand(0x08, [0x10, 0x0d]);
    }

    /**
      * Request the mute status of the audio in a zone.
      *
      * @method getMute
      * @return {Promise} [A response]
      */
    getMute() {
        return this.sendCommand(Options.MuteOptions.Command, Options.MuteOptions.Status, this.getEvent('mute'));
    }

    /**
      * Heartbeat command to check unit is still connected and communication - also resets the EuP standby timer.
      *
      * @method heartbeat
      * @return {Promise}
      */
    heartbeat() {
        return this.sendCommand(Options.HeartbeatOptions.Command, Options.HeartbeatOptions.Status, this.getEvent('heartbeat'));
    }
}

module.exports = ArcamClient
