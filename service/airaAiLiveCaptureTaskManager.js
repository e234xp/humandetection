"use strict";
var net = require('net');
const fs = require("fs");
var http = require('http')
var https = require('https');
const { S_IFREG } = require("constants");

var request = require('request');

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

const delay = (interval) => {
    return new Promise((resolve) => {
        setTimeout(resolve, interval);
    });
};

class airaAiLiveCaptureTaskManager {
    constructor() {
        const self = this;
        self.runTask = false;
        self.configChange = false;
        self.resizeWidth = 256;
        self.lastConfig = {};
        self.line_ImageRemaining = 1;
        self.configFileName = global.__dirname + "/airaai.conf";
        self.eventTriggerFileName = global.__dirname + "/event_trigger.conf";

        try {
            self.lastConfig = JSON.parse(fs.readFileSync(self.configFileName).toString("utf8"));
        }
        catch (e) { }
        //console.log( "aa", self.configFileName );

        try {
            self.eventTrigger = JSON.parse(fs.readFileSync(self.eventTriggerFileName).toString("utf8"));
            global.event_schedule_force_pass = self.eventTrigger.event_schedule_force_pass;

            console.log("==== event_schedule_force_pass Changed ====");
            console.log("event_schedule_force_pass", global.event_schedule_force_pass);
        }
        catch (e) { }
    };

    async stopService(wait, cb) {
        const self = this;
        if (wait === false) { if (cb) cb() };
        self.runTask = false;
        let needToCheck = true;
        while (needToCheck) {
            needToCheck = false;
            for (let w = 0; w < global.airaAiWorkers.length; w++) {
                const worker = global.airaAiWorkers[w];
                if (worker.isAvaiable === false) {
                    needToCheck = true;
                    const workerMission = {
                        cmd: "task_object_capture_stop"
                    };
                    worker.send(workerMission);
                }
            }
            await delay(1000);
        }
        if (wait === true) { if (cb) cb() };
        return new Promise((resolve) => {
            resolve({ mseeage: "ok" });
        });
    };

    async startService(cb) {
        const self = this;
        fs.watchFile(self.configFileName, (curr, prev) => {
            try {
                let newConfig = JSON.parse(fs.readFileSync(self.configFileName).toString("utf8"));
                if (JSON.stringify(self.lastConfig.live_channel_list) === JSON.stringify(newConfig.live_channel_list)) { }
                else {
                    // self.lastConfig = newConfig;
                    self.configChange = true;
                }
                self.lastConfig = newConfig;
            } catch (e) {
                self.configChange = true;
            }
        });

        fs.watchFile(self.eventTriggerFileName, (curr, prev) => {
            try {
                let newConfig = JSON.parse(fs.readFileSync(self.eventTriggerFileName).toString("utf8"));
                global.event_schedule_force_pass = newConfig.event_schedule_force_pass;

                console.log("==== event_schedule_force_pass Changed ====");
                console.log("event_schedule_force_pass", global.event_schedule_force_pass);

            } catch (e) { }
        });

        self.runTask = true;
        while (self.runTask) {
            self.configChange = false;
            try {
                let config = self.lastConfig;//JSON.parse( fs.readFileSync( self.configFileName ).toString('utf8') );
                for (let w = 0; w < global.airaAiWorkers.length; w++) {
                    if (config.live_channel_list && config.live_channel_list.length > w) {
                        const worker = global.airaAiWorkers[w];
                        const workerConfig = config.live_channel_list[w];
                        //const objectResizeWidth = ( config.object_capture && config.object_capture.object_resize_width ? config.object_capture.object_resize_width : 200 );
                        const objectResizeWidth = (workerConfig.object_resize_width ? workerConfig.object_resize_width : 200);

                        const workerUrl = workerConfig.url ? workerConfig.url : "rtsp://" + ((workerConfig.username && workerConfig.username.length > 0) ? (workerConfig.username + ":" + workerConfig.password + "@") : "") + workerConfig.server_ip + ":" + workerConfig.server_port + "/" + workerConfig.camera_id;
                        const captureIntervalMs = (workerConfig.capture_interval_ms ? workerConfig.capture_interval_ms : 1000);
                        const resultImageResizeWidth = (workerConfig.result_image_resize_width ? workerConfig.result_image_resize_width : 640);
                        const liveImageResizeWidth = (workerConfig.live_image_resize_width ? workerConfig.live_image_resize_width : 0);
                        const detectionSensitivity = (workerConfig.detection_sensitivity ? workerConfig.detection_sensitivity : 0.5);
                        const detectionThreshole = (workerConfig.detection_threshole ? workerConfig.detection_threshole : 0.8);

                        const fances = (workerConfig.fances ? workerConfig.fances : []);
                        const objectIndication = (workerConfig.object_indication ? workerConfig.object_indication : {});
                        const fpsControl = (workerConfig.fps_control ? workerConfig.fps_control : 0);
                        const desireOfTypes = (workerConfig.desire_of_types ? workerConfig.desire_of_types : ["person"]);

                        // const cameraId = workerConfig.camera_id;
                        const cameraId = workerConfig.uuid;
                        worker.send({
                            cmd: "task_object_capture_start",
                            data: {
                                worker_index: w,
                                object_resize_width: objectResizeWidth,
                                result_image_resize_width: resultImageResizeWidth,
                                live_image_resize_width: liveImageResizeWidth,
                                detection_sensitivity: detectionSensitivity,
                                detection_threshole: detectionThreshole,
                                desire_of_types: desireOfTypes,
                                target_media_info: {
                                    camera_id: cameraId,
                                    url: workerUrl,
                                    capture_interval_ms: captureIntervalMs,
                                    object_indication: objectIndication,
                                    fps_control: fpsControl,
                                    fances: fances
                                }
                            }
                        });
                    }
                }
            }
            catch (e) {
                //console.log( e );
            }

            while (self.runTask && self.configChange == false) {
                await delay(1000);
            }
            const stopCfg = {
                cmd: "task_object_capture_stop"
            }
            for (let w = 0; w < global.airaAiWorkers.length; w++) {
                global.airaAiWorkers[w].send(stopCfg);
            }

            while (true) {
                let allStopped = true;
                for (let w = 0; w < global.airaAiWorkers.length; w++) {
                    if (global.airaAiWorkers[w]._isBusy == true) {
                        allStopped = false;
                        break;
                    }
                }
                if (allStopped) break;
                await delay(1000);
            }
            //console.log( "all stopped" );
            let runCnt = 10;
            while (self.runTask && runCnt-- > 0) await delay(1000);
        }

        return new Promise((resolve) => {
            resolve({ mseeage: "done" });
        });
    }

    async messageFromWorker(worker, msg) {
        const self = this;
        if (msg.cmd) {
            if (msg.cmd === "notify_capture") {

                let config = self.lastConfig;
                try {
                    if (msg.result.object.data.in_fances == undefined && msg.result.object.data.touch_fances)
                        msg.result.object.data.in_fances = msg.result.object.data.touch_fances;

                    if (msg.result.object.data.in_fances && msg.result.object.data.in_fances.length > 0) {
                        msg.result.object.data.in_fances.forEach(fanceUuid => {
                            if (config.event_actions) config.event_actions.forEach(async (act) => {
                                if ((fanceUuid == act.fance_uuid) && act.enabled == true) {
                                    let nowDate = new Date();
                                    let now = nowDate.getTime();
                                    let day = nowDate.getDay();
                                    let hour = nowDate.getHours();

                                    let passSchedule = false;
                                    for (var key in act.weekly_schedule) {
                                        if (key == day) {
                                            if (act.weekly_schedule[key].indexOf(hour) >= 0) {
                                                passSchedule = true;
                                                break;
                                            }
                                        }
                                    }

                                    let passIOChecker = true;
                                    if (act.iobox_checker == true) {
                                        passIOChecker = false;

                                        try {
                                            let ioChecker = new net.Socket({ writeable: true });

                                            let pointValue = -1;
                                            ioChecker.on('data', (data) => {
                                                // console.log("ioChecker.on('data'", data);
                                                pointValue = data.toString().replace('+OCCH1:', '').replace('\n', '');
                                            });

                                            ioChecker.on('error', (err) => {
                                                console.error('Connection error: ' + err);
                                            });

                                            // console.log("ioChecker.connect", act.iobox_host, act.iobox_port);
                                            ioChecker.connect(act.iobox_port, act.iobox_host, () => {
                                                let rawHex = Buffer.from(`AT+OCCH${act.iobox_point}}=?\n`, "ascii");
                                                ioChecker.write(rawHex);
                                            });

                                            await delay(500);

                                            if (pointValue == act.iobox_singal)
                                                passIOChecker = true;
                                            else {
                                                await delay(500);
                                                if (pointValue == act.iobox_singal)
                                                    passIOChecker = true;
                                            }

                                            ioChecker.destroy();
                                        }
                                        catch (ex) {
                                            console.log(ex);
                                        }
                                    }

                                    if ((passSchedule && passIOChecker) || global.event_schedule_force_pass) {
                                        switch (act.adaptor_config.type) {
                                            case "io-box": {
                                                if (act.last_act_time_io_box == null) {
                                                    act["last_act_time_io_box"] = 0;
                                                }
                                                if (Date.now() - act.last_act_time_io_box > (act.interval != null ? act.interval : 5000)) {
                                                    act.last_act_time_io_box = now;
                                                    let client = new net.Socket();
                                                    let start = `AT+STACH${act.adaptor_config.channel}=${act.adaptor_config.start_signal}\n`;
                                                    let stop = `AT+STACH${act.adaptor_config.channel}=${act.adaptor_config.stop_signal}\n`;
                                                    let hold = act.adaptor_config.hold ? act.adaptor_config.hold : 1000;
                                                    client.on("error", () => { });
                                                    client.connect(act.adaptor_config.port, act.adaptor_config.host, async function () {
                                                        client.write(Buffer.from(start, 'ascii'));
                                                        await delay(hold);
                                                        client.write(Buffer.from(stop, 'ascii'));
                                                        await delay(1000);
                                                        client.end();
                                                        client.destroy();
                                                    });
                                                }
                                            } break;
                                            case "asia-east": {
                                                if (act.last_act_time_asia_east == null) {
                                                    act["last_act_time_asia_east"] = 0;
                                                }
                                                if (Date.now() - act.last_act_time_asia_east > (act.interval != null ? act.interval : 5000)) {
                                                    act.last_act_time_asia_east = now;
                                                    var post_data = {
                                                        event: act.adaptor_config.event,
                                                        systemType: act.adaptor_config.systemType,
                                                        level: act.adaptor_config.level,
                                                        datetime: nowDate.toISOString(),
                                                        deviceName: act.adaptor_config.deviceName,
                                                        uuid: msg.result.object.data.uuid,
                                                        logger: act.adaptor_config.logger
                                                    }

                                                    if (act.adaptor_config.photourl === true) {
                                                        post_data["photourl"] = msg.image ? msg.image : "";
                                                    }

                                                    var post_options = {
                                                        host: act.adaptor_config.url_host,
                                                        port: act.adaptor_config.url_port,
                                                        path: act.adaptor_config.url_path,
                                                        method: 'POST',
                                                        headers: {
                                                            'Content-Type': 'application/json',
                                                            'Content-Length': Buffer.byteLength(JSON.stringify(post_data))
                                                        }
                                                    };

                                                    var post_req = https.request(post_options, function (res) {
                                                        res.setEncoding('utf8');
                                                        res.on('data', function (chunk) {
                                                        });
                                                    });
                                                    post_req.on("error", function (err) { });
                                                    post_req.write(JSON.stringify(post_data));
                                                    post_req.end();

                                                }
                                            } break;
                                            case "nx": {
                                                if (act.last_act_time_nx == null) {
                                                    act["last_act_time_nx"] = 0;
                                                }
                                                if (Date.now() - act.last_act_time_nx > (act.interval != null ? act.interval : 5000)) {
                                                    act.last_act_time_nx = now;
                                                    var post_data = {
                                                        event: act.adaptor_config.event,
                                                        systemType: act.adaptor_config.systemType,
                                                        level: act.adaptor_config.level,
                                                        datetime: nowDate.toISOString(),
                                                        deviceName: act.adaptor_config.deviceName,
                                                        uuid: msg.result.object.data.uuid,
                                                        logger: act.adaptor_config.logger
                                                    }

                                                    if (act.adaptor_config.photourl === true) {
                                                        post_data["photourl"] = msg.image ? msg.image : "";
                                                    }

                                                    var use_https = act.adaptor_config.https != null ? act.adaptor_config.https : false;
                                                    var host = act.adaptor_config.url_host;
                                                    var port = act.adaptor_config.url_port;
                                                    var path = act.adaptor_config.url_path != null ? act.adaptor_config.url_path : "/api/createEvent";
                                                    var user = act.adaptor_config.url_user != null ? act.adaptor_config.url_user : "";
                                                    var pass = act.adaptor_config.url_pass != null ? act.adaptor_config.url_pass : "";
                                                    if (path.charAt(0) != "/") path = "/" + path;
                                                    var caption = act.adaptor_config.caption != null ? act.adaptor_config.caption : "";
                                                    var description = act.adaptor_config.caption != null ? act.adaptor_config.description : "";
                                                    var metadata = null;
                                                    // try {
                                                    //     if (act.adaptor_config.metadata != null) {
                                                    //         metadata = JSON.stringify(act.adaptor_config.metadata);
                                                    metadata = act.adaptor_config.metadata.replace(/\\/g, '');
                                                    //     }
                                                    // } catch (e) {
                                                    //     metadata = null;
                                                    // }

                                                    var host = act.adaptor_config.url_host;
                                                    var url = use_https ? "https://" : "http://";
                                                    if (user.length > 0 && pass.length > 0) url += `${user}:${pass}@`;

                                                    url += `${host}:${port}${path}?caption=${caption}&description=${description}`;
                                                    if (metadata != null) url += `&metadata=${metadata}`;
                                                    //url += `${host}:${port}${path}?caption=${encodeURI(caption)}&description=${encodeURI(description)}`;
                                                    console.log("nx event", url);

                                                    var q = (use_https ? https : http);
                                                    var get_req = q.request(url, function (res) {
                                                        res.on('data', function (chunk) { });
                                                    });
                                                    get_req.on("error", function (err) { });
                                                    get_req.end();
                                                }
                                            } break;
                                            case "line": {
                                                if (act.last_act_time_line == null) {
                                                    act["last_act_time_line"] = 0;
                                                }
                                                if (Date.now() - act.last_act_time_line > (act.interval != null ? act.interval : 5000)) {
                                                    act.last_act_time_line = now;

                                                    var token = act.adaptor_config.token != null ? act.adaptor_config.token : "";
                                                    var message = act.adaptor_config.message != null ? act.adaptor_config.message : "";
                                                    var withImage = act.adaptor_config.with_image != null ? act.adaptor_config.with_image : false;

                                                    if (token.length > 0) {
                                                        var notifyFormData = {
                                                            message: message
                                                        };
                                                        if (withImage && self.line_ImageRemaining > 0 && msg.result.object.data.object_image && msg.result.object.data.object_image.length > 0) {
                                                            notifyFormData["imageFile"] = {
                                                                value: Buffer.from(msg.result.object.data.object_image, "base64"),
                                                                options: {
                                                                    "filename": "airaai-" + msg.result.object.data.uuid + ".jpg",
                                                                    "contentType": "image/jpeg"
                                                                }
                                                            }
                                                        }
                                                        //console.log( msg.result.object.data.object_image )
                                                        console.log("line event", notifyFormData);
                                                        try {
                                                            request({
                                                                url: "https://notify-api.line.me/api/notify",
                                                                method: "POST",
                                                                pool: { maxSockets: 10 },
                                                                time: true,
                                                                timeout: 3000,
                                                                headers: {
                                                                    "Authorization": `Bearer ${token}`,
                                                                    "Content-Type": "multipart/form-data"
                                                                },
                                                                formData: notifyFormData
                                                            }, function (error, response, body) {
                                                                // console.log( error, body )
                                                                self.line_ImageRemaining = 1;
                                                                if (response && response.headers) {
                                                                    if (response.headers["x-ratelimit-imageremaining"]) self.line_ImageRemaining = response.headers["x-ratelimit-imageremaining"];
                                                                    else if (response.headers["X-RateLimit-ImageRemaining"]) self.line_ImageRemaining = response.headers["X-RateLimit-ImageRemaining"];
                                                                }
                                                            });
                                                        }
                                                        catch (e) {
                                                            console.log(e);
                                                            self.line_ImageRemaining = 1;
                                                        }
                                                    }
                                                }
                                            } break;
                                        }
                                    }
                                }
                            });
                        });
                    }
                    // if (msg.result.object.data.touch_fances && msg.result.object.data.touch_fances.length > 0) {
                    //     msg.result.object.data.touch_fances.forEach(fanceUuid => {
                    //         if (config.event_actions) config.event_actions.forEach(act => {
                    //             if ((fanceUuid == act.fance_uuid) && act.enabled == true) {
                    //                 let nowDate = new Date();
                    //                 let now = nowDate.getTime();
                    //                 let day = nowDate.getDay();
                    //                 let hour = nowDate.getHours();

                    //                 let passSchedule = false;
                    //                 for (var key in act.weekly_schedule) {
                    //                     if (key == day) {
                    //                         if (act.weekly_schedule[key].indexOf(hour) >= 0) {
                    //                             passSchedule = true;
                    //                             break;
                    //                         }
                    //                     }
                    //                 }

                    //                 if (passSchedule || global.event_schedule_force_pass) {
                    //                     switch (act.adaptor_config.type) {
                    //                         case "io-box": {
                    //                             if (act.last_act_time_io_box == null) {
                    //                                 act["last_act_time_io_box"] = 0;
                    //                             }
                    //                             if (Date.now() - act.last_act_time_io_box > (act.interval != null ? act.interval : 5000)) {
                    //                                 act.last_act_time_io_box = now;
                    //                                 let client = new net.Socket();
                    //                                 let start = `AT+STACH${act.adaptor_config.channel}=${act.adaptor_config.start_signal}\n`;
                    //                                 let stop = `AT+STACH${act.adaptor_config.channel}=${act.adaptor_config.stop_signal}\n`;
                    //                                 let hold = act.adaptor_config.hold ? act.adaptor_config.hold : 1000;
                    //                                 client.on("error", () => { });
                    //                                 client.connect(act.adaptor_config.port, act.adaptor_config.host, async function () {
                    //                                     client.write(Buffer.from(start, 'ascii'));
                    //                                     await delay(hold);
                    //                                     client.write(Buffer.from(stop, 'ascii'));
                    //                                     await delay(1000);
                    //                                     client.end();
                    //                                     client.destroy();
                    //                                 });
                    //                             }
                    //                         } break;
                    //                         case "asia-east": {
                    //                             if (act.last_act_time_asia_east == null) {
                    //                                 act["last_act_time_asia_east"] = 0;
                    //                             }
                    //                             if (Date.now() - act.last_act_time_asia_east > (act.interval != null ? act.interval : 5000)) {
                    //                                 act.last_act_time_asia_east = now;
                    //                                 var post_data = {
                    //                                     event: act.adaptor_config.event,
                    //                                     systemType: act.adaptor_config.systemType,
                    //                                     level: act.adaptor_config.level,
                    //                                     datetime: nowDate.toISOString(),
                    //                                     deviceName: act.adaptor_config.deviceName,
                    //                                     uuid: msg.result.object.data.uuid,
                    //                                     logger: act.adaptor_config.logger
                    //                                 }

                    //                                 if (act.adaptor_config.photourl === true) {
                    //                                     post_data["photourl"] = msg.image ? msg.image : "";
                    //                                 }

                    //                                 var post_options = {
                    //                                     host: act.adaptor_config.url_host,
                    //                                     port: act.adaptor_config.url_port,
                    //                                     path: act.adaptor_config.url_path,
                    //                                     method: 'POST',
                    //                                     headers: {
                    //                                         'Content-Type': 'application/json',
                    //                                         'Content-Length': Buffer.byteLength(JSON.stringify(post_data))
                    //                                     }
                    //                                 };

                    //                                 var post_req = https.request(post_options, function (res) {
                    //                                     res.setEncoding('utf8');
                    //                                     res.on('data', function (chunk) {
                    //                                     });
                    //                                 });
                    //                                 post_req.on("error", function (err) { });
                    //                                 post_req.write(JSON.stringify(post_data));
                    //                                 post_req.end();

                    //                             }
                    //                         } break;
                    //                         case "nx": {
                    //                             if (act.last_act_time_nx == null) {
                    //                                 act["last_act_time_nx"] = 0;
                    //                             }
                    //                             if (Date.now() - act.last_act_time_nx > (act.interval != null ? act.interval : 5000)) {
                    //                                 act.last_act_time_nx = now;
                    //                                 var post_data = {
                    //                                     event: act.adaptor_config.event,
                    //                                     systemType: act.adaptor_config.systemType,
                    //                                     level: act.adaptor_config.level,
                    //                                     datetime: nowDate.toISOString(),
                    //                                     deviceName: act.adaptor_config.deviceName,
                    //                                     uuid: msg.result.object.data.uuid,
                    //                                     logger: act.adaptor_config.logger
                    //                                 }

                    //                                 if (act.adaptor_config.photourl === true) {
                    //                                     post_data["photourl"] = msg.image ? msg.image : "";
                    //                                 }

                    //                                 var use_https = act.adaptor_config.https != null ? act.adaptor_config.https : false;
                    //                                 var host = act.adaptor_config.url_host;
                    //                                 var port = act.adaptor_config.url_port;
                    //                                 var path = act.adaptor_config.url_path != null ? act.adaptor_config.url_path : "/api/createEvent";
                    //                                 var user = act.adaptor_config.url_user != null ? act.adaptor_config.url_user : "";
                    //                                 var pass = act.adaptor_config.url_pass != null ? act.adaptor_config.url_pass : "";
                    //                                 if (path.charAt(0) != "/") path = "/" + path;
                    //                                 var caption = act.adaptor_config.caption != null ? act.adaptor_config.caption : "";
                    //                                 var description = act.adaptor_config.caption != null ? act.adaptor_config.description : "";
                    //                                 var metadata = null;
                    //                                 // try {
                    //                                 //     if (act.adaptor_config.metadata != null) {
                    //                                 //         metadata = JSON.stringify(act.adaptor_config.metadata);
                    //                                 metadata = act.adaptor_config.metadata.replace(/\\/g, '');
                    //                                 //     }
                    //                                 // } catch (e) {
                    //                                 //     metadata = null;
                    //                                 // }

                    //                                 var host = act.adaptor_config.url_host;
                    //                                 var url = use_https ? "https://" : "http://";
                    //                                 if (user.length > 0 && pass.length > 0) url += `${user}:${pass}@`;

                    //                                 url += `${host}:${port}${path}?caption=${caption}&description=${description}`;
                    //                                 if (metadata != null) url += `&metadata=${metadata}`;
                    //                                 //url += `${host}:${port}${path}?caption=${encodeURI(caption)}&description=${encodeURI(description)}`;
                    //                                 console.log("nx event", url);

                    //                                 var q = (use_https ? https : http);
                    //                                 var get_req = q.request(url, function (res) {
                    //                                     res.on('data', function (chunk) { });
                    //                                 });
                    //                                 get_req.on("error", function (err) { });
                    //                                 get_req.end();
                    //                             }
                    //                         } break;
                    //                         case "line": {
                    //                             if (act.last_act_time_line == null) {
                    //                                 act["last_act_time_line"] = 0;
                    //                             }
                    //                             if (Date.now() - act.last_act_time_line > (act.interval != null ? act.interval : 5000)) {
                    //                                 act.last_act_time_line = now;

                    //                                 var token = act.adaptor_config.token != null ? act.adaptor_config.token : "";
                    //                                 var message = act.adaptor_config.message != null ? act.adaptor_config.message : "";
                    //                                 var withImage = act.adaptor_config.with_image != null ? act.adaptor_config.with_image : false;

                    //                                 if (token.length > 0) {
                    //                                     var notifyFormData = {
                    //                                         message: message
                    //                                     };
                    //                                     if (withImage && self.line_ImageRemaining > 0 && msg.result.object.data.object_image && msg.result.object.data.object_image.length > 0) {
                    //                                         notifyFormData["imageFile"] = {
                    //                                             value: Buffer.from(msg.result.object.data.object_image, "base64"),
                    //                                             options: {
                    //                                                 "filename": "airaai-" + msg.result.object.data.uuid + ".jpg",
                    //                                                 "contentType": "image/jpeg"
                    //                                             }
                    //                                         }
                    //                                     }
                    //                                     //console.log( msg.result.object.data.object_image )
                    //                                     console.log("line event", notifyFormData);
                    //                                     try {
                    //                                         request({
                    //                                             url: "https://notify-api.line.me/api/notify",
                    //                                             method: "POST",
                    //                                             pool: { maxSockets: 10 },
                    //                                             time: true,
                    //                                             timeout: 3000,
                    //                                             headers: {
                    //                                                 "Authorization": `Bearer ${token}`,
                    //                                                 "Content-Type": "multipart/form-data"
                    //                                             },
                    //                                             formData: notifyFormData
                    //                                         }, function (error, response, body) {
                    //                                             // console.log( error, body )
                    //                                             self.line_ImageRemaining = 1;
                    //                                             if (response && response.headers) {
                    //                                                 if (response.headers["x-ratelimit-imageremaining"]) self.line_ImageRemaining = response.headers["x-ratelimit-imageremaining"];
                    //                                                 else if (response.headers["X-RateLimit-ImageRemaining"]) self.line_ImageRemaining = response.headers["X-RateLimit-ImageRemaining"];
                    //                                             }
                    //                                         });
                    //                                     }
                    //                                     catch (e) {
                    //                                         console.log(e);
                    //                                         self.line_ImageRemaining = 1;
                    //                                     }
                    //                                 }
                    //                             }
                    //                         } break;
                    //                     }
                    //                 }
                    //             }
                    //         });
                    //     });
                    // }

                    global.airaAiDbManager.writeDb(msg);
                    // }
                    // if (msg.image) delete msg["image"];
                    // global.airaAiDbManager.writeDb(msg);
                }
                catch (e) {
                    console.log(e);
                }
            }
            else if (msg.cmd === "notify_done") {
                //console.log( "done" );
                worker.isAvaiable = true;
            }
            else if (msg.cmd === "notify_break") {
                //console.log( "break" );
                worker.isAvaiable = true;
            }
            else if (msg.cmd === "notify_error") {
                //console.log( "error !!!" );
                worker.isAvaiable = true;
            }
        }
    }
}

module.exports = airaAiLiveCaptureTaskManager;
