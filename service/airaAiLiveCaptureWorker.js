"use strict";

const fs = require('fs');

var uuid = require('uuid');
const beamcoder = require("ken_beamcoder");
const http = require('http');
const mjpegServer = require('mjpeg-server');

// to use gm you have to insatall graphicsmagick --> sudo apt install graphicsmagick
const gm = require('gm');

function delay(interval) {
    return new Promise((resolve) => {
        setTimeout(resolve, interval);
    });
};

class airaAiLiveCaptureWorker {
    constructor() {
        const self = this;
        self._isBusy = false;
        self._run = false;
        self._msg = null;
        self._imageListToProcess = [];
        self._captureProcessIsBusy = false;
        self._imageProcessIsBusy = false;
        self.mjpegServerListener = null;
        self.lastSocketKey = 0;
        self.reqHandlerMap = {};

        process.on("message", (msg) => {
            if (msg.cmd === "task_object_capture_stop") {
                self._run = false;
                if (self.mjpegServerListener) {
                    self.mjpegServerListener.close();
                    self.mjpegServerListener = null;
                }
            }
            else if (msg.cmd === "task_object_capture_start") {
                if (self._isBusy === false) {
                    self._isBusy = true;
                    self._run = true;
                    self._msg = msg;
                    self._captureProcessIsBusy = true;
                    self._imageProcessIsBusy = true;
                    self.mjpegServerListener = http.createServer(function (request, response) {
                        if (response && response.socket) {
                            response.socket.on("error", (err) => { });
                            let socketKey = ++self.lastSocketKey;
                            self.reqHandlerMap[socketKey] = mjpegServer.createReqHandler(request, response);
                            response.socket.on('close', function () {
                                try {
                                    delete self.reqHandlerMap[socketKey];
                                }
                                catch (e) {
                                }
                            });
                        }
                    }).listen(10001 + msg.data.worker_index);
                    self._capture_process(msg);
                    self._image_process();
                }
            }
        });

        self._doFanceDetection = async function (jpg, objs) {
            let objectIndication = self._msg.data.target_media_info.object_indication;
            //let gmImg = gm( Buffer.from(jpg, "base64") );
            let gmImg = gm(jpg);
            let alertFances = [];
// console.log( "fancesㄙㄩㄣ", self._msg.data.target_media_info.fances);
// console.log( "objs", objs);
            if (self._msg.data.target_media_info.fances != null) {
                if (objs.length == 0) {
                    self._msg.data.target_media_info.fances.forEach(fance => {
                        if (fance.draw === true) {
                            var polygonPt = [];
                            fance.polygon.forEach(pt => {
                                polygonPt.push([pt.x, pt.y])
                            });
                            gmImg.stroke("blue", 3).fill("None");
                            gmImg.drawPolygon(polygonPt);
                        }
                    });
                }
                else {
                    self._msg.data.target_media_info.fances.forEach(fance => {
                        var fanceHasSomethingInside = false;

                        if (fance.detect === true) {
                            objs.forEach(obj => {
                                var rect = obj.object_rect.split(",");
                                var x0 = Number(rect[0]);
                                var y0 = Number(rect[1]);
                                var w = Number(rect[2]);
                                var h = Number(rect[3]);
                                var x1 = x0 + w;
                                var y1 = y0 + h;
                                var objInsidePolygons = false;

                                if (fance.detect_mode === "in") {
                                    var checkPoint_X_LIST = [];
                                    var wp = w / (fance.detect_sensitivity ? fance.detect_sensitivity : 10);

                                    for (var i = 0; i <= (fance.detect_sensitivity ? fance.detect_sensitivity : 10); i++) {
                                        checkPoint_X_LIST.push(Number(x0 + (wp * i)));
                                    }
                                    //var checkPoint_X = console.log( checkPoint_X, checkPoint_Y );
                                    var checkPoint_Y = Number(y0 + h);
                                    var insideCnt = 0;
                                    checkPoint_X_LIST.forEach(checkPoint_X => {
                                        //gmImg.stroke( 8 ).fill( "None" );
                                        // gmImg.drawCircle( checkPoint_X, checkPoint_Y, checkPoint_X + 2, checkPoint_Y + 2 );

                                        if (
                                            global.airaAi.pointInsidePolygons(JSON.stringify(
                                                {
                                                    point: {
                                                        x: checkPoint_X,
                                                        y: checkPoint_Y
                                                    },
                                                    polygon: fance.polygon
                                                }
                                            ))
                                        ) insideCnt++;
                                    });

                                    // objInsidePolygons = global.airaAi.pointInsidePolygons( JSON.stringify({
                                    //     point : {
                                    //         x : checkPoint_X,
                                    //         y : checkPoint_Y
                                    //     },
                                    //     polygon : fance.polygon
                                    // }));
                                    objInsidePolygons = (insideCnt >= (fance.detect_threshole ? fance.detect_threshole : 1));

                                    if (objInsidePolygons) {
                                        if (obj.in_fances != null) obj.in_fances.push(fance.uuid);
                                        else obj.in_fances = [fance.uuid];
                                    }
                                }
                                else if (fance.detect_mode === "touch") {
                                    if (obj.touch_fances != null) obj.touch_fances.push(fance.uuid);
                                    else obj["touch_fances"] = [fance.uuid];
                                }

                                if (objInsidePolygons) {
                                    var fl = alertFances.filter(f => f.uuid == fance.uuid);

                                    if (fl.length == 0) {
                                        alertFances.push({
                                            uuid: fance.uuid,
                                            objs: [
                                                {
                                                    uuid: obj.uuid,
                                                    x: x0,
                                                    y: y0,
                                                    w: w,
                                                    h: h
                                                }
                                            ]
                                        });
                                    }
                                    else {
                                        fl[0].objs.push({
                                            uuid: obj.uuid,
                                            x: x0,
                                            y: y0,
                                            w: w,
                                            h: h
                                        });
                                    }
                                }

                                // if( objInsidePolygons === true ) gmImg.stroke( "red", 2 ).fill( "None" );
                                // else gmImg.stroke( "green", 2 ).fill( "None" );

                                // gmImg.drawRectangle( x0, y0, x1, y1 );

                                fanceHasSomethingInside |= objInsidePolygons;
                            });
                        }

                        if (fance.draw == true) {
                            var fancePolygonPt = [];
                            fance.polygon.forEach(pt => {
                                fancePolygonPt.push([pt.x, pt.y])
                            });


                            if (fanceHasSomethingInside) gmImg.stroke(fance.alert_color ? fance.alert_color : "red", fance.alert_line_border ? fance.alert_line_border : 3).fill("None");
                            else gmImg.stroke(fance.normal_color ? fance.normal_color : "blue", fance.normal_line_border ? fance.normal_line_border : 3).fill("None");
                            gmImg.drawPolygon(fancePolygonPt);
                        }
                    });

                    objs.forEach(obj => {
                        var rect = obj.object_rect.split(",");
                        var x0 = Number(rect[0]);
                        var y0 = Number(rect[1]);
                        var w = Number(rect[2]);
                        var h = Number(rect[3]);
                        var x1 = x0 + w;
                        var y1 = y0 + h;
                        var objInsidePolygons = (obj.in_fances != null || obj.touch_fances != null);
                        if (objInsidePolygons === true) gmImg.stroke(objectIndication.alert_color ? objectIndication.alert_color : "red", objectIndication.alert_line_border ? objectIndication.alert_line_border : 2).fill("None");
                        else gmImg.stroke(objectIndication.normal_color ? objectIndication.normal_color : "green", objectIndication.normal_line_border ? objectIndication.normal_line_border : 2).fill("None");

                        gmImg.drawRectangle(x0, y0, x1, y1);
                    });
                }

            }
            else {
                objs.forEach(obj => {
                    var rect = obj.object_rect.split(",");
                    var x0 = Number(rect[0]);
                    var y0 = Number(rect[1]);
                    var w = Number(rect[2]);
                    var h = Number(rect[3]);
                    var x1 = x0 + w;
                    var y1 = y0 + h;
                    var objInsidePolygons = obj.objInsidePolygons;
                    if (objInsidePolygons === true) gmImg.stroke(objectIndication.alert_color ? objectIndication.alert_color : "red", objectIndication.alert_line_border ? objectIndication.alert_line_border : 2).fill("None");
                    else gmImg.stroke(objectIndication.normal_color ? objectIndication.normal_color : "green", objectIndication.normal_line_border ? objectIndication.normal_line_border : 2).fill("None");

                    gmImg.drawRectangle(x0, y0, x1, y1);
                });
            }
            return new Promise((resolve) => {
                resolve({ gm_image: gmImg, alert_fances: alertFances });
            });
        }
        self._image_process = async function () {
            while (self._run) {
                while (self._run && self._imageListToProcess.length > 0) {
                    var imageToProcess = self._imageListToProcess.shift();
                    var objectList = await self._fun_findObjectWithFeature(imageToProcess.jpegPacket.data, imageToProcess.currentVideoTime);
                    if( objectList.length > 0 ) console.log( `found ${objectList.length} objects.`, new Date() );
                    if (imageToProcess.callback) imageToProcess.callback(null, false, objectList);
                }
                await delay(100);
            }
            while (self._captureProcessIsBusy) {
                await delay(1000);
            }
            while (self._imageListToProcess.length > 0) {
                self._imageListToProcess.shift();
            }
            self._imageProcessIsBusy = false;
            self._isBusy = false;
        }

        self._capture_process = async function (msg) {
            await self._fun_processMedia(function (err, fineshed, detectRes) {
                if (detectRes && detectRes.result) {
                    while (detectRes.result.length > 0) {
                        var object = detectRes.result.shift();
                        process.send({
                            cmd: "notify_capture",
                            worker_index: self._msg.data.worker_index,
                            image: detectRes.image,
                            result: {
                                camera_id: self._msg.data.target_media_info.camera_id,
                                object: object
                            }
                        });
                    }
                }
                if (fineshed) {
                    process.send({
                        cmd: "notify_done",
                        worker_index: self._msg.data.worker_index
                    });
                }
                else if (err === "error") {
                    process.send({
                        cmd: "notify_error",
                        worker_index: self._msg.data.worker_index
                    });
                }
                else if (err === "break") {
                    process.send({
                        cmd: "notify_break",
                        worker_index: self._msg.data.worker_index
                    });
                }
            });
            self._captureProcessIsBusy = false;
            // if( self._imageProcessIsBusy == false ) {
            //     self._isBusy = false;
            // }
        }

        self._fun_processMedia = async function (cb) {
            const fpsControl = (self._msg.data.target_media_info.fps_control ? self._msg.data.target_media_info.fps_control : 0);
            const targetFrameProcessInterval = self._msg.data.target_media_info.capture_interval_ms;
            const targetMedia = self._msg.data.target_media_info.url;
            const mediaOption = {
                url: targetMedia
            };
            if (targetMedia.includes("rtsp://")) {
                mediaOption["options"] = {
                    //rtsp_transport : "tcp",
                    rtsp_flags: "prefer_tcp",
                    stimeout: 3000000,
                }
            }
            while (self._run) {
                try {
                    console.log('targetMedia', targetMedia);
                    let mediaDemuxer = await beamcoder.demuxer(mediaOption);
                    if (mediaDemuxer != null) {
                        let videoStream = mediaDemuxer.streams.find(x => x.codecpar.codec_type === "video");
                        if (videoStream && videoStream.codecpar && videoStream.codecpar.format) {
                            let mediaDecoder = beamcoder.decoder({ params: videoStream.codecpar });
                            let mediaEncoder = beamcoder.encoder({
                                name: "mjpeg",
                                width: videoStream.codecpar.width,
                                height: videoStream.codecpar.height,
                                pix_fmt: videoStream.codecpar.format.indexOf("422") >= 0 ? "yuvj422p" : "yuvj420p",
                                time_base: [1, 1]
                            });

                            let foundKeyFrame = false;
                            let currentVideoTime = 0;
                            let lastFrameProcessTime = 0;
                            let lastPts = 0;
                            //let gcFrameCounter = 0;
                            while (self._run) {
                                // if( gcFrameCounter++ > 30 ) {
                                //     gcFrameCounter = 0;
                                //     try {if (global.gc) {global.gc();}} catch (e) {}
                                // }
                                try {
                                    var packet = await mediaDemuxer.read();
                                    if (packet != null) {
                                        if (packet.stream_index === videoStream.index) { // find index of video stream )
                                            if (packet.flags.KEY) {
                                                foundKeyFrame = true;
                                            }
                                            if (foundKeyFrame) {
                                                var decResult = await mediaDecoder.decode(packet);
                                                while (decResult && decResult.frames.length > 0) {
                                                    var yuvFrame = decResult.frames.shift();
                                                    if (lastPts != packet.pts) {
                                                        currentVideoTime = Date.now();
                                                        if ((currentVideoTime - lastFrameProcessTime) >= targetFrameProcessInterval) {
                                                            lastFrameProcessTime = currentVideoTime;
                                                            if (self._imageListToProcess.length < 10) {
                                                                yuvFrame.pts = Date.now();
                                                                var encResult = await mediaEncoder.encode(yuvFrame); // Encode the frame
                                                                while (encResult && encResult.packets.length > 0) {
                                                                    var jpegPacket = encResult.packets.shift();
                                                                    self._imageListToProcess.push({
                                                                        jpegPacket: jpegPacket,
                                                                        currentVideoTime: currentVideoTime,
                                                                        callback: cb
                                                                    });
                                                                }
                                                            }
                                                        }
                                                    }
                                                    else foundKeyFrame = false;
                                                }
                                            }
                                            lastPts = packet.pts;
                                        }
                                        if (fpsControl != 0) await delay(1000 / fpsControl);
                                    }
                                    else {
                                        //console.log("no frame");
                                        break;
                                    }
                                } catch (e) { }
                            }
                            //console.log("stop decoder");
                            try { await mediaDecoder.flush(); } catch (e) { } mediaDecoder = null;
                            //console.log("stop encoder");
                            try { await mediaEncoder.flush(); } catch (e) { } mediaEncoder = null;
                        }
                        //console.log("stop demuxer");
                        try { mediaDemuxer.forceClose(); } catch (e) { } mediaDemuxer = null;
                        //console.log("done");
                    }
                }
                catch (e) { }
                var cnt = 10;
                while (self._run && cnt-- > 0) await delay(1000);
            }

            if (self._run == false) {
                if (cb) {
                    cb("break", true, null, null);
                }
            }
            return new Promise((resolve) => {
                resolve({ mseeage: "done." });
            });
        }

        self._sendVideoToClients = async function (gmImg) {
            var imageToSend = null;
            if (self._msg.data.live_image_resize_width > 0) imageToSend = gmImg.resize(self._msg.data.live_image_resize_width, null);
            else imageToSend = gmImg;
            imageToSend.toBuffer('JPG', function (err, buffer) {
                if (!err && buffer) for (let key in self.reqHandlerMap) {
                    if (self.reqHandlerMap[key]) {
                        try {
                            self.reqHandlerMap[key]._write(buffer, "", function () { });
                        }
                        catch (e) {
                            console.log("mjpg send err : ", e);
                        }
                    }
                }
            });
        }

        self._fun_findObjectWithFeature = async function (jpegData, currentVideoTime, cb) {
            var objectResizeWidth = (self._msg.data.object_resize_width ? self._msg.data.object_resize_width : 200);
            var detectionSensitivity = (self._msg.data.detection_sensitivity ? self._msg.data.detection_sensitivity : 0.5);
            var detectionThreshole = (self._msg.data.detection_threshole ? self._msg.data.detection_threshole : 0.8);
            var desireOfTypes = (self._msg.data.desire_of_types ? self._msg.data.desire_of_types : null);
            var returnResult = {};
            try {
                var startTime = Date.now();
                //var detectResult = JSON.parse( global.airaAi.detectFromBuffer( jpegData, objectResizeWidth, detectionSensitivity, 0.8 ) );
                var detectResult = JSON.parse(global.airaAi.detectFromBuffer(jpegData, objectResizeWidth, detectionSensitivity, detectionThreshole));

                detectResult.objects.forEach(o => {
                    o["uuid"] = uuid.v4();
                })

                var filteredDetectResultObjects = desireOfTypes ? detectResult.objects.filter(o => (desireOfTypes.filter(dot => dot == o.type).length > 0)) : detectResult.objects;

                var fanceDetectRes = await self._doFanceDetection(jpegData, filteredDetectResultObjects, self.processFanceDetectionResult);

                self._sendVideoToClients(fanceDetectRes.gm_image);

                if (filteredDetectResultObjects.length > 0) {
                    returnResult["result"] = [];

                    filteredDetectResultObjects.forEach(obj => {
                        returnResult.result.push({
                            timestamp: Math.round(currentVideoTime),
                            data: obj
                        });
                    });
                }
                // self._sendEventToClients( fanceDetectRes.alert_fances );
            }
            catch (e) {
            }

            return new Promise((resolve) => {
                try {
                    var resizedImg = fanceDetectRes.gm_image.resize(self._msg.data.result_image_resize_width, null);

                    if (resizedImg) {
                        resizedImg.toBuffer('JPG', function (err, buf) {
                            if (!err) returnResult["image"] = buf.toString('base64');
                            if (cb) cb(returnResult);
                            resolve(returnResult);
                        });
                    }
                    else {
                        resolve(returnResult);
                    }
                }
                catch (e) {
                    resolve(returnResult);
                }
            });
        }
    }
}

module.exports = airaAiLiveCaptureWorker; 
