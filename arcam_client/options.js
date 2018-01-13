'use strict';

const MuteOptions      = require('./options/mute_options'),
      VolumeOptions    = require('./options/volume_options'),
      HeartbeatOptions = require('./options/heartbeat_options')

module.exports = {
    /**
     * @property MuteOptions
     * @type {MuteOptions}
     */
    MuteOptions: MuteOptions,

    /**
     * @property VolumeOptions
     * @type {VolumeOptions}
     */
    VolumeOptions: VolumeOptions,

    /**
     * @property HeartbeatOptions
     * @type {HeartbeatOptions}
     */
    HeartbeatOptions: HeartbeatOptions,
};
