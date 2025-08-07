"use strict";

const debug = require("debug")("roon-extension-arcam"),
    debug_keepalive = require("debug")("roon-extension-arcam:keepalive"),
    Promise = require("bluebird"),
    Arcam = require("./arcam_client"),
    RoonApi = require("node-roon-api"),
    RoonApiSettings = require("node-roon-api-settings"),
    RoonApiStatus = require("node-roon-api-status"),
    RoonApiVolumeControl = require("node-roon-api-volume-control");

/**
 * Structured error codes for different failure scenarios
 */
const ErrorCodes = {
    // Connection errors (1000-1999)
    CONNECTION_REFUSED: { code: 1001, category: 'CONNECTION', severity: 'HIGH' },
    CONNECTION_TIMEOUT: { code: 1002, category: 'CONNECTION', severity: 'HIGH' },
    HOST_UNREACHABLE: { code: 1003, category: 'CONNECTION', severity: 'HIGH' },
    HOST_NOT_FOUND: { code: 1004, category: 'CONNECTION', severity: 'HIGH' },
    CONNECTION_RESET: { code: 1005, category: 'CONNECTION', severity: 'MEDIUM' },
    NETWORK_UNREACHABLE: { code: 1006, category: 'CONNECTION', severity: 'HIGH' },
    CONNECTION_UNKNOWN: { code: 1999, category: 'CONNECTION', severity: 'MEDIUM' },
    
    // Protocol errors (2000-2999)
    PROTOCOL_PARSE_ERROR: { code: 2001, category: 'PROTOCOL', severity: 'HIGH' },
    PROTOCOL_TIMEOUT: { code: 2002, category: 'PROTOCOL', severity: 'MEDIUM' },
    PROTOCOL_INVALID_RESPONSE: { code: 2003, category: 'PROTOCOL', severity: 'MEDIUM' },
    
    // Device errors (3000-3999)
    DEVICE_NOT_CONFIGURED: { code: 3001, category: 'DEVICE', severity: 'HIGH' },
    DEVICE_INITIALIZATION_FAILED: { code: 3002, category: 'DEVICE', severity: 'HIGH' },
    DEVICE_COMMAND_FAILED: { code: 3003, category: 'DEVICE', severity: 'MEDIUM' },
    
    // System errors (4000-4999)
    SYSTEM_INTERNAL_ERROR: { code: 4001, category: 'SYSTEM', severity: 'HIGH' },
    SYSTEM_RESOURCE_ERROR: { code: 4002, category: 'SYSTEM', severity: 'MEDIUM' }
};

/**
 * Create structured error with code, category and user message
 * @param {string} errorType - Error type from ErrorCodes
 * @param {Error} originalError - Original error object
 * @param {string} context - Additional context information
 * @returns {Object} Structured error object
 */
function createStructuredError(errorType, originalError, context = '') {
    const errorInfo = ErrorCodes[errorType] || ErrorCodes.SYSTEM_INTERNAL_ERROR;
    
    return {
        code: errorInfo.code,
        category: errorInfo.category,
        severity: errorInfo.severity,
        type: errorType,
        message: getErrorMessage(errorType, originalError),
        originalError: originalError,
        context: context,
        timestamp: new Date().toISOString()
    };
}

/**
 * Get user-friendly error message based on error type
 * @param {string} errorType - Error type from ErrorCodes
 * @param {Error} originalError - Original error object
 * @returns {string} User-friendly error message
 */
function getErrorMessage(errorType, originalError) {
    switch (errorType) {
        case 'CONNECTION_REFUSED':
            return `Cannot connect to receiver: Connection refused. Please verify the receiver is powered on and the IP address is correct.`;
        
        case 'HOST_UNREACHABLE':
            return `Cannot reach receiver: Host unreachable. Please check your network connection and firewall settings.`;
        
        case 'CONNECTION_TIMEOUT':
            return `Connection timed out: Receiver did not respond. Please verify the receiver is on the same network and port 50000 is accessible.`;
        
        case 'HOST_NOT_FOUND':
            return `Hostname not found: Cannot resolve receiver address. Please verify the hostname or use an IP address instead.`;
        
        case 'CONNECTION_RESET':
            return `Connection reset by receiver: The receiver closed the connection unexpectedly. This may be temporary.`;
        
        case 'NETWORK_UNREACHABLE':
            return `Network unreachable: Cannot route to receiver. Please check your network configuration.`;
        
        case 'DEVICE_NOT_CONFIGURED':
            return `Device not configured: Please check settings and provide a valid receiver hostname or IP address.`;
        
        case 'DEVICE_INITIALIZATION_FAILED':
            return `Device initialization failed: Could not set up volume control. Please check receiver compatibility.`;
        
        case 'DEVICE_COMMAND_FAILED':
            return `Command failed: The receiver did not respond to the volume or mute command. Please try again.`;
        
        case 'PROTOCOL_PARSE_ERROR':
            return `Protocol error: Invalid response from receiver. Please check receiver firmware compatibility.`;
        
        case 'PROTOCOL_TIMEOUT':
            return `Protocol timeout: Receiver did not respond within expected time. Connection may be unstable.`;
        
        case 'PROTOCOL_INVALID_RESPONSE':
            return `Invalid response: Receiver sent unexpected data. Please check receiver model compatibility.`;
        
        default:
            const message = originalError?.message || originalError?.toString() || 'Unknown error';
            return `Connection failed: ${message}. Please check receiver power, network connection, and settings.`;
    }
}

/**
 * Map native Node.js errors to structured error types
 * @param {Error} error - Native Node.js error
 * @returns {string} Mapped error type from ErrorCodes
 */
function mapNativeErrorToType(error) {
    if (!error || !error.code) {
        return 'CONNECTION_UNKNOWN';
    }
    
    switch (error.code) {
        case 'ECONNREFUSED': return 'CONNECTION_REFUSED';
        case 'EHOSTUNREACH': return 'HOST_UNREACHABLE';
        case 'ETIMEDOUT': return 'CONNECTION_TIMEOUT';
        case 'ENOTFOUND': return 'HOST_NOT_FOUND';
        case 'ECONNRESET': return 'CONNECTION_RESET';
        case 'ENETUNREACH': return 'NETWORK_UNREACHABLE';
        default: return 'CONNECTION_UNKNOWN';
    }
}

/**
 * Format connection errors into user-friendly messages with structured error codes
 * @param {Error} error - The connection error
 * @param {string} context - Additional context information
 * @returns {Object} Structured error object with user message
 */
function formatConnectionError(error, context = '') {
    if (!error) {
        return createStructuredError('SYSTEM_INTERNAL_ERROR', null, context);
    }

    const errorType = mapNativeErrorToType(error);
    return createStructuredError(errorType, error, context);
}

/**
 * Check if error is critical and requires immediate attention
 * @param {Object} structuredError - Structured error object
 * @returns {boolean} True if error is critical
 */
function isCriticalError(structuredError) {
    return structuredError.severity === 'HIGH' || 
           ['DEVICE_NOT_CONFIGURED', 'CONNECTION_REFUSED', 'HOST_NOT_FOUND'].includes(structuredError.type);
}

/**
 * Get error category for grouping and filtering
 * @param {Object} structuredError - Structured error object
 * @returns {string} Error category
 */
function getErrorCategory(structuredError) {
    return structuredError.category;
}

/**
 * Export error codes for external use (testing, logging, monitoring)
 */
const ERROR_CODES = ErrorCodes;

var arcam = {};
var roon = new RoonApi({
    extension_id: "org.pruessmann.roon.arcam",
    display_name: "Arcam AVR390/550/850/AV860/SR250",
    display_version: "2025.1.1",
    publisher: "Doc Bobo",
    email: "docbobo@pm.me",
    website: "https://github.com/docbobo/roon-extension-arcam",
});

var mysettings = roon.load_config("settings") || {
    hostname: "",
    keepalive: 60000,
};

function make_layout(settings) {
    var l = {
        values: settings,
        layout: [],
        has_error: false,
    };

    l.layout.push({
        type: "string",
        title: "Host name or IP Address",
        subtitle: "The IP address or hostname of the Arcam receiver.",
        maxlength: 256,
        setting: "hostname",
    });

    return l;
}

var svc_settings = new RoonApiSettings(roon, {
    get_settings: function (cb) {
        cb(make_layout(mysettings));
    },
    save_settings: function (req, isdryrun, settings) {
        let l = make_layout(settings.values);
        req.send_complete(l.has_error ? "NotValid" : "Success", {
            settings: l,
        });

        if (!isdryrun && !l.has_error) {
            var old_hostname = mysettings.hostname;
            mysettings = l.values;
            svc_settings.update_settings(l);
            if (old_hostname != mysettings.hostname)
                setup_arcam_connection(
                    mysettings.hostname,
                    mysettings.keepalive,
                );
            roon.save_config("settings", mysettings);
        }
    },
});

var svc_status = new RoonApiStatus(roon);
var svc_volume_control = new RoonApiVolumeControl(roon);

roon.init_services({
    provided_services: [svc_status, svc_settings, svc_volume_control],
});

function setup_arcam_connection(host, keepalive) {
    debug("setup_arcam_connection (" + host + ")");

    if (arcam.keepalive) {
        clearInterval(arcam.keepalive);
        arcam.keepalive = null;
    }
    if (arcam.client) {
        arcam.client.disconnect();
        delete arcam.client;
    }

    if (!keepalive) {
        keepalive = 60000;
    }

    if (!host) {
        const configError = createStructuredError('DEVICE_NOT_CONFIGURED', null, 'setup_arcam_connection');
        debug("Device not configured [%d]: %s", configError.code, configError.type);
        svc_status.set_status(configError.message, true);
    } else {
        debug("Connecting to receiver...");
        svc_status.set_status("Connecting to '" + host + "'...", false);

        arcam.client = new Arcam.ArcamClient(host);
        arcam.client.socket.setTimeout(0);
        arcam.client.socket.setKeepAlive(true, 10000);

        arcam.client.socket.on("error", (error) => {
            // Handler for debugging purposes. No need to reconnect since the event will be followed by a close event,
            // according to documentation.
            debug("Received onError(%O)", error);
        });

        arcam.client.socket.on("timeout", () => {
            debug("Received onTimeout(): Closing connection...");
            arcam.client.disconnect();
        });

        arcam.client.on("close", (had_error) => {
            debug("Received onClose(%O): Reconnecting...", had_error);
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

        arcam.client
            .connect()
            .then(() => {
                create_volume_control(arcam).then(() => {
                    svc_status.set_status("Connected to '" + host + "'", false);
                });
            })
            .catch((error) => {
                debug(
                    "setup_arcam_connection: Error during setup. Retrying...",
                );

                // Enhanced error handling with structured messages
                const structuredError = formatConnectionError(error, 'setup_arcam_connection');
                debug("Connection error [%d]: %s - %O", structuredError.code, structuredError.type, structuredError);
                svc_status.set_status(structuredError.message, true);
            });

        arcam.keepalive = setInterval(() => {
            // Make regular calls to heartbeat for keep-alive.
            arcam.client.heartbeat().then((val) => {
                debug_keepalive("Keep-Alive: heartbeat == %s", val);
            });
        }, keepalive);
    }
    debug("setup_arcam_connection (" + host + ") - done.");
}

function create_volume_control(arcam) {
    debug("create_volume_control: volume_control=%o", arcam.volume_control);

    var result = arcam.client;
    if (!arcam.volume_control) {
        arcam.state = {
            control_key: 1,
            display_name: "Main Zone",
            volume_type: "number",
            volume_min: 0,
            volume_max: 99,
            volume_step: 1,
        };

        var device = {
            state: arcam.state,

            set_volume: function (req, mode, value) {
                debug("set_volume: mode=%s value=%d", mode, value);

                let newvol =
                    mode == "absolute" ? value : state.volume_value + value;
                if (newvol < this.state.volume_min)
                    newvol = this.state.volume_min;
                else if (newvol > this.state.volume_max)
                    newvol = this.state.volume_max;

                arcam.client
                    .setVolume(newvol)
                    .then(() => {
                        debug("set_volume: Succeeded.");
                        req.send_complete("Success");
                    })
                    .catch((error) => {
                        const structuredError = createStructuredError('DEVICE_COMMAND_FAILED', error, 'set_volume');
                        debug("Volume command failed [%d]: %s - %O", structuredError.code, structuredError.type, structuredError);
                        req.send_complete("Failed");
                    });
            },

            set_mute: function (req, inAction) {
                debug("set_mute: action=%s", inAction);

                const action = !this.state.is_muted ? "on" : "off";
                arcam.client
                    .setMute(
                        action === "on"
                            ? Arcam.Options.MuteOptions.On
                            : Arcam.Options.MuteOptions.Off,
                    )
                    .then(() => {
                        debug("set_mute: Succeeded.");
                        req.send_complete("Success");
                    })
                    .catch((error) => {
                        const structuredError = createStructuredError('DEVICE_COMMAND_FAILED', error, 'set_mute');
                        debug("Mute command failed [%d]: %s - %O", structuredError.code, structuredError.type, structuredError);
                        req.send_complete("Failed");
                    });
            },
        };

        result = Promise.join(
            arcam.client.getVolume(),
            arcam.client.getMute(),
            function (volume, is_muted) {
                arcam.state.volume_value = volume;
                arcam.state.is_muted =
                    is_muted === Arcam.Options.MuteOptions.On;

                debug("Registering volume control extension");
                arcam.volume_control = svc_volume_control.new_device(device);
            },
        ).catch((error) => {
            const structuredError = createStructuredError('DEVICE_INITIALIZATION_FAILED', error, 'create_volume_control');
            debug("Device initialization failed [%d]: %s - %O", structuredError.code, structuredError.type, structuredError);
        });
    }

    return result.then(() => {
        debug("Subscribing to events from receiver");

        arcam.client.on("muteChanged", (val) => {
            debug("muteChanged: val=%s", val);

            let old_is_muted = arcam.state.is_muted;
            arcam.state.is_muted = val === Arcam.Options.MuteOptions.On;
            if (old_is_muted != arcam.state.is_muted) {
                debug("mute differs - updating");
                arcam.volume_control.update_state({
                    is_muted: arcam.state.is_muted,
                });
            }
        });

        arcam.client.on("masterVolumeChanged", (val) => {
            debug("masterVolumeChanged: val=%s", val);

            let old_volume_value = arcam.state.volume_value;
            arcam.state.volume_value = val;
            if (old_volume_value != arcam.state.volume_value) {
                debug("masterVolume differs - updating");
                arcam.volume_control.update_state({
                    volume_value: arcam.state.volume_value,
                });
            }
        });
    });
}

setup_arcam_connection(mysettings.hostname, mysettings.keepalive);

debug("Starting Roon Discovery.");
roon.start_discovery();
