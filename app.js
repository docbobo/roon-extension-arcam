'use strict';

const debug                = require('debug')('roon-extension-arcam'),
      debug_keepalive      = require('debug')('roon-extension-arcam:keepalive'),
      Promise              = require('bluebird'),
      Arcam                = require('./arcam_client'),
      RoonApi              = require('node-roon-api'),
      RoonApiSettings      = require('node-roon-api-settings'),
      RoonApiStatus        = require('node-roon-api-status'),
      RoonApiVolumeControl = require('node-roon-api-volume-control');

var arcam = {};
var roon = new RoonApi({
    extension_id:        'org.pruessmann.roon.arcam',
    display_name:        'Arcam AVR390/550/850/AV860/SR250',
    display_version:     '0.0.4',
    publisher:           'Doc Bobo',
    email:               'boris@pruessmann.org',
    website:             'https://github.com/docbobo/roon-extension-arcam',
});

var mysettings = roon.load_config("settings") || {
    hostname: "",
    keepalive: 60000
};

function make_layout(settings) {
    var l = {
        values:    settings,
        layout:    [],
        has_error: false
    };

    l.layout.push({
        type:      "string",
        title:     "Host name or IP Address",
        subtitle:  "The IP address or hostname of the Arcam receiver.",
        maxlength: 256,
        setting:   "hostname",
    });

    return l;
}

var svc_settings = new RoonApiSettings(roon, {
    get_settings: function(cb) {
        cb(make_layout(mysettings));
    },
    save_settings: function(req, isdryrun, settings) {
        let l = make_layout(settings.values);
        req.send_complete(l.has_error ? "NotValid" : "Success", { settings: l });

        if (!isdryrun && !l.has_error) {
            var old_hostname = mysettings.hostname;
            mysettings = l.values;
            svc_settings.update_settings(l);
            if (old_hostname != mysettings.hostname) setup_arcam_connection(mysettings.hostname, mysettings.keepalive);
            roon.save_config("settings", mysettings);
        }
    }
});

var svc_status = new RoonApiStatus(roon);
var svc_volume_control = new RoonApiVolumeControl(roon);

roon.init_services({
    provided_services: [ svc_status, svc_settings, svc_volume_control ]
});

function setup_arcam_connection(host, keepalive) {
    debug("setup_arcam_connection (" + host + ")");

    if (arcam.keepalive) { clearInterval(arcam.keepalive); arcam.keepalive = null; }
    if (arcam.client) { arcam.client.disconnect(); delete(arcam.client); }

    if (!host) {
        svc_status.set_status("Not configured, please check settings.", true);
    } else {
        debug("Connecting to receiver...");
        svc_status.set_status("Connecting to '" + host + "'...", false);

        arcam.client = new Arcam.ArcamClient(host);
        arcam.client.socket.setTimeout(0);
        arcam.client.socket.setKeepAlive(true, 10000);

        arcam.client.socket.on('error', (error) => {
            // Handler for debugging purposes. No need to reconnect since the event will be followed by a close event,
            // according to documentation.
            debug('Received onError(%O)', error);
        });

        arcam.client.socket.on('timeout', () => {
            debug('Received onTimeout(): Closing connection...');
            arcam.client.disconnect();
        });

        arcam.client.on('close', (had_error) => {
            debug('Received onClose(%O): Reconnecting...', had_error);
            svc_status.set_status("Connection closed. Reconnecting...", true);

            if (!arcam.reconnect) {
                arcam.reconnect = setTimeout(() => {
                    debug("Attempting to reconnect");
                    arcam.client.connect().then(() => {
                        arcam.reconnect = null;
                        svc_status.set_status("Connected to receiver", false);
                    });
                }, 1000);
            }
        });

        arcam.client.connect().then(() => {
            create_volume_control(arcam).then(() => {
                svc_status.set_status("Connected to '" + host + "'", false);
            });
        }).catch((error) => {
            debug("setup_arcam_connection: Error during setup. Retrying...");

            // TODO: Fix error message
            console.log(error);
            svc_status.set_status("Could not connect receiver: " + error, true);
        });

        arcam.keepalive = setInterval(() => {
            // Make regular calls to heartbeat for keep-alive.
            arcam.client.heartbeat().then((val) => {
                debug_keepalive("Keep-Alive: heartbeat == %s", val);
            });
        }, keepalive);
    }
}

function create_volume_control(arcam) {
    debug("create_volume_control: volume_control=%o", arcam.volume_control)

    var result = arcam.client;
    if (!arcam.volume_control) {
        arcam.state = {
            display_name: "Main Zone",
            volume_type:  "number",
            volume_min:   0,
            volume_max:   99,
            volume_step:  1,
        };

        var device = {
            state: arcam.state,

            set_volume: function (req, mode, value) {
                debug("set_volume: mode=%s value=%d", mode, value);

                let newvol = mode == "absolute" ? value : (state.volume_value + value);
                if      (newvol < this.state.volume_min) newvol = this.state.volume_min;
                else if (newvol > this.state.volume_max) newvol = this.state.volume_max;

                arcam.client.setVolume(newvol).then(() => {
                    debug("set_volume: Succeeded.");
                    req.send_complete("Success");
                }).catch((error) => {
                    debug("set_volume: Failed with error.");

                    console.log(error);
                    req.send_complete("Failed");
                });
            },

            set_mute: function (req, inAction) {
                debug("set_mute: action=%s", inAction);

                const action = !this.state.is_muted ? "on" : "off";
                arcam.client.setMute(action === "on" ? Arcam.Options.MuteOptions.On : Arcam.Options.MuteOptions.Off).then(() => {
                    debug("set_mute: Succeeded.");
                    req.send_complete("Success");
                }).catch((error) => {
                    debug("set_mute: Failed.");

                    console.log(error);
                    req.send_complete("Failed");
                });
            }
        };

        result = Promise.join(arcam.client.getVolume(), arcam.client.getMute(), function(volume, is_muted) {
            arcam.state.volume_value = volume;
            arcam.state.is_muted = (is_muted === Arcam.Options.MuteOptions.On);

            debug("Registering volume control extension");
            arcam.volume_control = svc_volume_control.new_device(device);
        }).catch((error) => {
            console.log(error);
        });
    }

    return result.then(() => {
        debug("Subscribing to events from receiver");

        arcam.client.on('muteChanged', (val) => {
            debug("muteChanged: val=%s", val);

            let old_is_muted = arcam.state.is_muted;
            arcam.state.is_muted = val === Arcam.Options.MuteOptions.On;
            if (old_is_muted != arcam.state.is_muted) {
                debug("mute differs - updating");
                arcam.volume_control.update_state({ is_muted: arcam.state.is_muted });
            }
        });

        arcam.client.on('masterVolumeChanged', (val) => {
            debug("masterVolumeChanged: val=%s", val);

            let old_volume_value = arcam.state.volume_value;
            arcam.state.volume_value = val;
            if (old_volume_value != arcam.state.volume_value) {
                debug("masterVolume differs - updating");
                arcam.volume_control.update_state({ volume_value: arcam.state.volume_value });
            }
        });
    });
}

setup_arcam_connection(mysettings.hostname, mysettings.keepalive);

roon.start_discovery();
