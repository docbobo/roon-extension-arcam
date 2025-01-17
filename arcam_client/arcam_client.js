"use strict";

const debug = require("debug")("roon-extension-arcam:client"),
    _ = require("lodash"),
    Promise = require("bluebird"),
    Connection = require("./connection"),
    Options = require("./options"),
    Parser = require("binary-parser").Parser,
    Buffer = require("buffer").Buffer;

/**
 * The Arcam AVR RPC class.
 *
 * @class ArcamClient
 * @extends Connection
 */
class ArcamClient extends Connection {
    constructor(host, port = 50000) {
        super(host, port);

        this.requestParser = new Parser()
            .uint8("startTransmission", { assert: 0x21 })
            .uint8("zoneNumber")
            .uint8("commandCode")
            .uint8("dataLength")
            .buffer("data", { type: "uint8", length: "dataLength" })
            .uint8("endTransmission", { assert: 0x0d });

        this.responseParser = new Parser()
            .uint8("startTransmission", { assert: 0x21 })
            .uint8("zoneNumber")
            .uint8("commandCode")
            .uint8("answerCode")
            .uint8("dataLength")
            .buffer("data", { type: "uint8", length: "dataLength" })
            .uint8("endTransmission", { assert: 0x0d });

        this.commandTable = {
            heartbeat: {
                commandCode: Options.HeartbeatOptions.Command,
                /**
                 * @event heartbeat
                 */
                emit: "heartbeat",
            },
            masterVolume: {
                commandCode: Options.VolumeOptions.Command,
                /**
                 * @event masterVolumeChanged
                 * @param {object} volume The current volume
                 */
                emit: "masterVolumeChanged",
            },
            mute: {
                commandCode: Options.MuteOptions.Command,
                /**
                 * @event muteChanged
                 * @param {MuteOptions} mute The current mute status
                 */
                emit: "muteChanged",
            },
        };

        this.on("data", (data) => {
            this._onData(data);
        });

        this.on("error", (error) => {});
    }

    /**
     * Receives the incoming data.
     *
     * @method _onData
     * @private
     * @param  {Buffer} data The incoming data
     */
    _onData(data) {
        if (typeof data === "object") {
            const message = this.responseParser.parse(data);
            debug("Received message: %O = %o", data.toString("hex"), message);

            if (message.answerCode == 0x00) {
                const results = this._applyCommandMapping(message);
                results.forEach((result) => {
                    // Only Main Zone support for now
                    if (result.zoneNumber == 0x01) {
                        this.emit(result.emit, result.value);
                    }
                });
            }
        }
    }

    getEvent(key) {
        if (typeof this.commandTable[key] !== "undefined") {
            return this.commandTable[key].emit;
        } else {
            return undefined;
        }
    }

    _applyCommandMapping(message) {
        const keys = _(this.commandTable).keys();
        const matches = [];

        _(keys).each((key) => {
            const handler = this.commandTable[key];

            if (handler.commandCode === message.commandCode) {
                const matchResult = handler;
                matchResult.zoneNumber = message.zoneNumber;

                // If the event hook has a transform method call it before applying the result value
                if (matchResult.transform) {
                    matchResult.value = matchResult.transform(message.data);
                } else {
                    matchResult.value = message.data.readUInt8(0);
                }

                matches.push(matchResult);
            }
        });

        return matches;
    }

    sendCommand(commandCode, parameters, hook) {
        return new Promise((resolve) => {
            if (typeof hook === "string") {
                this.once(hook, (result) => {
                    resolve(result);
                });
            }

            if (!Array.isArray(parameters)) {
                parameters = [parameters];
            }

            const requestMessage = Buffer.concat(
                [
                    Buffer.from([0x21, 0x01, commandCode, parameters.length]),
                    Buffer.from(parameters),
                    Buffer.from([0x0d]),
                ],
                parameters.length + 5,
            );
            debug(
                "Sending Command: %O = %o",
                requestMessage.toString("hex"),
                this.requestParser.parse(requestMessage),
            );

            return this.write(requestMessage).then(() => {
                if (typeof hook === "undefined") {
                    resolve();
                }
            });
        });
    }

    setVolume(volumeOptions) {
        return this.sendCommand(Options.VolumeOptions.Command, volumeOptions);
    }

    /**
     * Request the volume of a zone. This command returns the volume even if the zone requested is in mute.
     *
     * @method getVolume
     * @return {Promise} [A response]
     */
    getVolume() {
        return this.sendCommand(
            Options.VolumeOptions.Command,
            Options.VolumeOptions.Status,
            this.getEvent("masterVolume"),
        );
    }

    setMute(mute) {
        // Muting the receiver is done via RC command emulation, thus the command code differs from the one on getMute.
        return this.sendCommand(0x08, [0x10, 0x0d]);
    }

    /**
     * Request the mute status of the audio in a zone.
     *
     * @method getMute
     * @return {Promise} [A response]
     */
    getMute() {
        return this.sendCommand(
            Options.MuteOptions.Command,
            Options.MuteOptions.Status,
            this.getEvent("mute"),
        );
    }

    /**
     * Heartbeat command to check unit is still connected and communication - also resets the EuP standby timer.
     *
     * @method heartbeat
     * @return {Promise}
     */
    heartbeat() {
        return this.sendCommand(
            Options.HeartbeatOptions.Command,
            Options.HeartbeatOptions.Status,
            this.getEvent("heartbeat"),
        );
    }
}

module.exports = ArcamClient;
