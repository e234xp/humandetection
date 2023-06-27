"use strict";
const fs = require("fs");
const writeToFile = require("write-to-file");
const TAFFY = require('taffy');

var disk = require('diskusage');
const { v4: uuidv4 } = require('uuid');

const delay = (interval) => {
    return new Promise((resolve) => {
        setTimeout(resolve, interval);
    });
};

class airaAiDbManager {
    constructor(workingFolder) {
        const self = this;
        self.runTask = false;
        self.mainThreadStopped = true;

        self.currentDBStartTime = 0;
        self.firstRecord = false;
        self.currentDBEndTime = 0;
        self.DBTime = 3600000000;
        self.workingFolder = workingFolder;


        self.serviceStarted = false;
        self.workingDBFolder = "";
        self.configFileName = global.__dirname + "/airaai.conf";


        self.toGB = function (x) {
            //return (x / (1024 * 1024 * 1024)).toFixed(1); 
            return (x / 1000000000).toFixed(1);
        }
        self.removeFile = function (f) {
            fs.stat(f, function (err, stats) {
                if (err) {
                    return console.error(err);
                }
                fs.unlink(f, function (err) {
                    if (err) return console.log(err);
                    //console.log( "remove ", f );
                });
            });
        }
        self.createDataFolder = function () {
            try {
                if (self.config.object_capture.db.db_root_folder) {
                    if (!fs.existsSync(self.config.object_capture.db.db_root_folder)) {
                        fs.mkdirSync(self.config.object_capture.db.db_root_folder);
                    }
                    if (!fs.existsSync(self.workingDBFolder)) {
                        fs.mkdirSync(self.workingDBFolder);
                    }
                }
            }
            catch (e) { }
        }

        try {
            self.config = JSON.parse(fs.readFileSync(self.configFileName).toString('utf8'));
            if (self.config.object_capture.db.db_root_folder) {
                self.workingDBFolder = self.config.object_capture.db.db_root_folder + "/data/";
                //console.log("workingDBFolder", self.workingDBFolder);
            }
            self.createDataFolder();
        }
        catch (e) {
            console.log(`${e}`);
            self.config = null;
        }
    };

    async stopService(wait, cb) {
        const self = this;
        if (wait === false) { if (cb) cb() };
        self.runTask = false;
        while (self.mainThreadStopped == false) {
            await delay(1000);
        }
        self.serviceStarted = false;
        if (wait === true) { if (cb) cb() };
        return new Promise((resolve) => {
            resolve();
        });
    };

    async startService(cb) {
        const self = this;
        self.runTask = true;
        self.mainThreadStopped = false;
        self.serviceStarted = true;

        fs.watchFile(self.configFileName, (curr, prev) => {
            try {
                self.config = JSON.parse(fs.readFileSync(self.configFileName).toString('utf8'));
                //console.log( self.config );
                if (self.config.object_capture.db.db_root_folder) {
                    self.workingDBFolder = self.config.object_capture.db.db_root_folder + "/data/";
                }
                self.createDataFolder();
            }
            catch (e) {
            }
        });

        while (self.runTask) {
            try {
                let filesToRemove = [];
                var files = fs.readdirSync(self.workingDBFolder);
                if (files.length > 0) {
                    var sortedFiles = files.sort((a, b) => {
                        var aStat = fs.statSync(`${self.workingDBFolder}/${a}`),
                            bStat = fs.statSync(`${self.workingDBFolder}/${b}`);
                        return new Date(aStat.birthtime).getTime() - new Date(bStat.birthtime).getTime();
                    });
                    var diskInfo = await disk.check(self.workingDBFolder);
                    var diskLeftGB = self.toGB(diskInfo.available);
                    var freeSpaceNeeded = (self.config.object_capture.db.maintain_disk_space_in_gb ? self.config.object_capture.db.maintain_disk_space_in_gb : 10);

                    if (freeSpaceNeeded > diskLeftGB) {
                        var removeAmount = sortedFiles.length >= 2 ? 2 : 1;
                        while (removeAmount-- > 0) {
                            filesToRemove.push(sortedFiles.shift());
                        }
                    }

                    var maintain_duration = (self.config.object_capture.db.maintain_duration != null ? self.config.object_capture.db.maintain_duration : 1209600000);
                    sortedFiles.forEach(file => {
                        var mainOfStr = file.split('.');
                        if (mainOfStr.length == 2) {
                            var partsOfStr = mainOfStr[0].split('_');
                            if (partsOfStr.length == 4) {
                                var ttCheck = Date.now() - maintain_duration;
                                if (ttCheck >= partsOfStr[2]) {
                                    filesToRemove.push(file);
                                }
                            }
                        }
                    });
                    if (filesToRemove.length > 0) {
                        filesToRemove.forEach(file => {
                            fs.lstat(self.workingDBFolder + file, function (err, stats) {
                                if (stats.isDirectory()) {
                                    try { fs.rmdirSync(self.workingDBFolder + file, { recursive: true, force: true }); }
                                    catch (e) { }

                                }
                                else {
                                    try { self.removeFile(self.workingDBFolder + file); }
                                    catch (e) { }
                                }
                            });
                        });
                    }
                }
            }
            catch (e) { console.log(e.toString()); }
            await delay(60000);
        }
        self.mainThreadStopped = true;
        return new Promise((resolve) => {
            resolve();
        });
    }

    //await .readDb( 1616631599261, 1616632199261 + 1, ["47941387-e760-e396-61d3-f93c63a045b6","47941387-e760-e396-61d3-f93c63a045b7"] );
    async readRecordCount(startTime, endTime, cameraIdList, cb) {
        const self = this;
        return new Promise((resolve) => {
            try {
                // let qStartTime = Date.now();
                fs.readdir(self.workingDBFolder, (err, files) => {
                    if (!err) {
                        let dataArray = 0;
                        files.forEach(file => {
                            let mainOfStr = file.split('.');
                            if (mainOfStr.length == 2 && mainOfStr[1] == "db") {
                                let partsOfStr = mainOfStr[0].split('_');
                                if (partsOfStr.length == 4) {
                                    if ((startTime >= partsOfStr[1] && startTime <= partsOfStr[2]) ||
                                        (endTime >= partsOfStr[1] && endTime <= partsOfStr[2]) ||
                                        (startTime <= partsOfStr[1] && endTime >= partsOfStr[2]) ||
                                        (startTime >= partsOfStr[1] && endTime <= partsOfStr[2])) {

                                        if (cameraIdList.indexOf(partsOfStr[3]) >= 0) {
                                            try {
                                                let dbData = JSON.parse("[{}" + fs.readFileSync(self.workingDBFolder + file).toString('utf8') + "]");
                                                let dbDataObj = new TAFFY(dbData);
                                                let query = { timestamp: { lt: endTime + 1, gt: startTime - 1 } };
                                                dataArray += dbDataObj(query).count();

                                                dbData = null;
                                                dbDataObj = null;
                                            }
                                            catch (err) { }
                                        }
                                    }
                                }
                            }
                        });
                        // console.log("success, readRecordCount total time cost : ", Date.now() - qStartTime, " ms, dataArray amount : ", dataArray);
                        if (cb) cb(dataArray);
                        resolve(dataArray);
                    }
                    else {
                        if (cb) cb([]);
                        resolve([]);
                    }
                });
            }
            catch (e) {
                if (cb) cb([]);
                resolve([]);
            }
        });
    }


    async readDb(startTime, endTime, cameraIdList, cb) {
        const self = this;
        return new Promise((resolve) => {
            try {

                fs.readdir(self.workingDBFolder, (err, files) => {
                    if (!err) {
                        //let dataRecordset = null;
                        let qStartTime = Date.now();

                        const dataArray = [];
                        files.forEach(file => {
                            let mainOfStr = file.split('.');
                            if (mainOfStr.length == 2 && mainOfStr[1] == "db") {
                                let partsOfStr = mainOfStr[0].split('_');

                                if (partsOfStr.length >= 3) {
                                    //console.log( self.workingDBFolder + file, startTime, endTime, (startTime >= partsOfStr[1] && startTime <= partsOfStr[2]), (endTime >= partsOfStr[1] && endTime <= partsOfStr[2]) );
                                    if ((startTime >= partsOfStr[1] && startTime <= partsOfStr[2]) ||
                                        (endTime >= partsOfStr[1] && endTime <= partsOfStr[2]) ||
                                        (startTime <= partsOfStr[1] && endTime >= partsOfStr[2]) ||
                                        (startTime >= partsOfStr[1] && endTime <= partsOfStr[2])) {

                                        if (partsOfStr.length == 4) {
                                            // console.log("readdb file 4 ", self.workingDBFolder, partsOfStr[1], partsOfStr[2], partsOfStr[3] );
                                            // console.log("readdb file 4 ", cameraIdList);    
                                            if (cameraIdList.indexOf(partsOfStr[3]) >= 0) {
                                                // console.log("readdb file 4 in");
                                                try {
                                                    let dbData = JSON.parse("[{}" + fs.readFileSync(self.workingDBFolder + file).toString('utf8') + "]");
                                                    let dbDataObj = new TAFFY(dbData);
                                                    let query = {
                                                        timestamp: {
                                                            lt: endTime + 1,
                                                            gt: startTime - 1
                                                        }
                                                    };

                                                    // if( dataArray.length < 1000 ) {
                                                    let dataRecordset = dbDataObj(query).order("timestamp desc");
                                                    // let dataRecordset = dbDataObj().order("timestamp desc");
                                                    dataRecordset.each(function (r) {
                                                        try {
                                                            let data = JSON.parse(fs.readFileSync(r.data.object_file).toString('utf8'));
                                                            r.data["object_image"] = data.object_image;
                                                        } catch (e) { };

                                                        // if( dataArray.length < 1000 ) {
                                                        dataArray.push({
                                                            camera_id: r.camera_id,
                                                            timestamp: r.timestamp,
                                                            data: r.data
                                                        });
                                                        // }
                                                    });
                                                    dataRecordset = null;
                                                    // }

                                                    // console.log(dataArray.length ) ;
                                                }
                                                catch (err) {
                                                    // console.log("readdb file 4 in", err);


                                                }
                                            }
                                        }
                                        else {
                                            // console.log("readdb file 3 ", self.workingDBFolder, partsOfStr[1], partsOfStr[2] );

                                            try {
                                                let dbData = JSON.parse("[{}" + fs.readFileSync(self.workingDBFolder + file).toString('utf8') + "]");
                                                let dbDataObj = new TAFFY(dbData);
                                                let query = {
                                                    timestamp: {
                                                        lt: endTime + 1,
                                                        gt: startTime - 1
                                                    }
                                                };
                                                if (cameraIdList != null && cameraIdList.length > 0) {
                                                    query["camera_id"] = cameraIdList
                                                }

                                                // if( dataArray.length < 1000 ) {
                                                let dataRecordset = dbDataObj(query).order("timestamp desc");
                                                // let dataRecordset = dbDataObj().sort("timestamp desc");

                                                dataRecordset.each(function (r) {
                                                    try {
                                                        let data = JSON.parse(fs.readFileSync(r.data.object_file).toString('utf8'));
                                                        r.data["object_image"] = data.object_image;
                                                    } catch (e) { };

                                                    // if( dataArray.length < 1000 ) {
                                                    dataArray.push({
                                                        camera_id: r.camera_id,
                                                        timestamp: r.timestamp,
                                                        data: r.data
                                                    });

                                                    // }
                                                });

                                                dataRecordset = null;
                                                // }
                                            }
                                            catch (err) { }
                                        }
                                    }
                                }
                            }
                        });

                        console.log("success, readDb total cost : ", Date.now() - qStartTime, " ms, file amount : ", dataArray.length);
                        if (cb) cb(dataArray);
                        resolve(dataArray);
                    }
                    else {
                        console.log("on error 1, readDb total cost : ", Date.now() - qStartTime, " ms");
                        if (cb) cb([]);
                        resolve([]);
                    }
                });
            }
            catch (e) {
                console.log("on error 2, readDb total cost : ", Date.now() - qStartTime, " ms");
                if (cb) cb([]);
                resolve([]);
            }
        });
    }

    async readDbBySlice(startTime, endTime, shift, sliceLength, withImage, cameraIdList, cb) {
        const self = this;
        return new Promise((resolve) => {
            try {
                let qStartTime = Date.now();
                fs.readdir(self.workingDBFolder, async (err, files) => {
                    if (!err) {
                        //let dataRecordset = null;
                        //let shiftCnt = 0;
                        const dataArray = [];
                        files.forEach(file => {
                            var mainOfStr = file.split('.');
                            if (mainOfStr.length == 2 && mainOfStr[1] == "db") {
                                var partsOfStr = mainOfStr[0].split('_');
                                if (partsOfStr.length == 4) {
                                    if ((startTime >= partsOfStr[1] && startTime <= partsOfStr[2]) ||
                                        (endTime >= partsOfStr[1] && endTime <= partsOfStr[2]) ||
                                        (startTime <= partsOfStr[1] && endTime >= partsOfStr[2]) ||
                                        (startTime >= partsOfStr[1] && endTime <= partsOfStr[2])) {
                                        if (cameraIdList.indexOf(partsOfStr[3]) >= 0) {
                                            try {

                                                var dbData = JSON.parse("[{}" + fs.readFileSync(self.workingDBFolder + file).toString('utf8') + "]");
                                                var dbDataObj = new TAFFY(dbData);
                                                var query = { timestamp: { lt: endTime + 1, gt: startTime - 1 } };
                                                //let dataRecordset = dbDataObj(query).order("timestamp desc");
                                                var dataRecordset = dbDataObj(query);
                                                dataRecordset.each(function (r) {
                                                    dataArray.push({
                                                        camera_id: r.camera_id,
                                                        timestamp: r.timestamp,
                                                        data: r.data
                                                    });
                                                });
                                                dataRecordset = null;
                                            }
                                            catch (err) {
                                                //console.log( err )
                                            }
                                        }
                                    }
                                }
                            }
                        });

                        try {

                            let shiftCnt = 0;
                            dataArray.sort(function (a, b) { return b.timestamp - a.timestamp; });
                            dataArray.forEach(function (r) {
                                if (withImage && shiftCnt >= shift && shiftCnt < (shift + sliceLength)) {
                                    try {
                                        var data = JSON.parse(fs.readFileSync(r.data.object_file).toString('utf8'));
                                        r.data["object_image"] = data.object_image;
                                    } catch (e) { };
                                }
                                delete r.data["object_file"];
                                shiftCnt++;
                            });
                        } catch (e) {
                            console.log(e)
                        };

                        console.log("success, readDbBySlice total time cost : ", Date.now() - qStartTime, " ms, dataArray amount : ", dataArray.length);
                        if (cb) cb(dataArray);
                        resolve(dataArray);
                    }
                    else {
                        if (cb) cb([]);
                        resolve([]);
                    }
                });
            }
            catch (e) {
                if (cb) cb([]);
                resolve([]);
            }
        });
    }

    async readDbBySliceNonBloking(startTime, endTime, shift, sliceLength, withImage, cameraIdList, cb) {
        const self = this;
        return new Promise((resolve) => {
            try {
                let qStartTime = Date.now();
                fs.readdir(self.workingDBFolder, async (err, files) => {
                    if (!err) {
                        //let dataRecordset = null;
                        let foundValidFile = false;

                        let finishedCnt = 0;
                        const dataArray = [];
                        files.forEach(file => {
                            var mainOfStr = file.split('.');
                            if (mainOfStr.length == 2 && mainOfStr[1] == "db") {
                                var partsOfStr = mainOfStr[0].split('_');
                                if (partsOfStr.length == 4) {
                                    if ((startTime >= partsOfStr[1] && startTime <= partsOfStr[2]) ||
                                        (endTime >= partsOfStr[1] && endTime <= partsOfStr[2]) ||
                                        (startTime <= partsOfStr[1] && endTime >= partsOfStr[2]) ||
                                        (startTime >= partsOfStr[1] && endTime <= partsOfStr[2])) {
                                        if (cameraIdList.indexOf(partsOfStr[3]) >= 0) {
                                            finishedCnt++;
                                            foundValidFile = true;
                                            fs.readFile(self.workingDBFolder + file, "utf-8", function (err, data) {
                                                if (!err) {
                                                    try {
                                                        var dbData = JSON.parse("[{}" + data + "]");
                                                        var dbDataObj = new TAFFY(dbData);
                                                        var query = { timestamp: { lt: endTime + 1, gt: startTime - 1 } };
                                                        var dataRecordset = dbDataObj(query);
                                                        //let dataRecordset = dbDataObj(query).order("timestamp desc");
                                                        dataRecordset.each(function (r) {
                                                            dataArray.push({ camera_id: r.camera_id, timestamp: r.timestamp, data: r.data });
                                                        });
                                                        dataRecordset = null;
                                                    }
                                                    catch (err) { }
                                                }
                                                finishedCnt--;
                                                if (finishedCnt <= 0) {
                                                    let shiftCnt = 0;
                                                    //try { dataArray.sort(function (a, b) { return a.timestamp - b.timestamp; }) } catch (err) {}
                                                    dataArray.sort(function (a, b) { return b.timestamp - a.timestamp; });
                                                    dataArray.forEach(function (r) {
                                                        if (withImage && shiftCnt >= shift && shiftCnt < (shift + sliceLength)) {
                                                            try {
                                                                var data = JSON.parse(fs.readFileSync(r.data.object_file).toString('utf8'));
                                                                r.data["object_image"] = data.object_image;
                                                            } catch (e) { };
                                                        }
                                                        delete r.data["object_file"];
                                                        shiftCnt++;
                                                    });
                                                    console.log("success, readDbBySliceNonBloking total time cost : ", Date.now() - qStartTime, " ms, dataArray amount : ", dataArray.length);
                                                    if (cb) cb(dataArray);
                                                    resolve(dataArray);
                                                }
                                            });
                                        }
                                    }
                                }
                            }
                        });

                        if (foundValidFile == false) {
                            if (cb) cb([]);
                            resolve([]);
                        }
                    }
                    else {
                        if (cb) cb([]);
                        resolve([]);
                    }
                });
            }
            catch (e) {
                if (cb) cb([]);
                resolve([]);
            }
        });
    }

    async writeDb(msg, resizedImage) {
        const self = this;
        if (self.serviceStarted) {
            try {
                const fileStartTime = Math.floor(msg.result.object.timestamp / self.config.object_capture.db.single_file_time) * self.config.object_capture.db.single_file_time;
                const fileEndTime = fileStartTime + self.config.object_capture.db.single_file_time - 1;
                const currentDBFileName = self.workingDBFolder + "/airaaidb_" + fileStartTime + "_" + fileEndTime + "_" + msg.result.camera_id + ".db";
                //const currentDBFileName = self.workingDBFolder + "/airatrackdb_" + fileStartTime + "_" + fileEndTime + ".db";
                const currentDBFolderName = currentDBFileName + "_object_data_folder";

                // console.log( "writeDb", currentDBFileName ) ;
                if (!fs.existsSync(self.workingDBFolder)) {
                    fs.mkdirSync(self.workingDBFolder);
                }
                if (!fs.existsSync(currentDBFolderName)) {
                    fs.mkdirSync(currentDBFolderName);
                }

                var currentUuid = uuidv4();
                var currentObjectFileName = currentDBFolderName + "/" + currentUuid + ".object";
                var currentSnapshotFileName = currentDBFolderName + "/" + currentUuid + ".snapshot";
                var objectRect = msg.result.object.data.object_rect.split(',');

                await writeToFile(currentDBFileName, "," + JSON.stringify({
                    camera_id: msg.result.camera_id,
                    timestamp: msg.result.object.timestamp,
                    data: {
                        id: currentUuid,
                        type: msg.result.object.data.type,
                        person_attribs: msg.result.object.data.person_attribs,
                        top_color: msg.result.object.data.top_color,
                        bottom_color: msg.result.object.data.bottom_color,
                        x: objectRect[0],
                        y: objectRect[1],
                        width: objectRect[2],
                        height: objectRect[3],
                        object_file: currentObjectFileName,
                        snapshot_file: currentSnapshotFileName,
                        feature: msg.result.object.data.feature,
                        in_fances: msg.result.object.data.in_fances
                    }
                }), { flag: "a" });

                await writeToFile(currentObjectFileName, JSON.stringify({
                    image: (resizedImage ? resizedImage : msg.result.object.data.object_image)
                }), { flag: "w" });

                await writeToFile(currentSnapshotFileName, JSON.stringify({
                    image: msg.image
                }), { flag: "w" });

                return new Promise((resolve) => {
                    resolve(true);
                });
            }
            catch (e) { }
        }
        return new Promise((resolve) => {
            resolve(false);
        });
    }
}

module.exports = airaAiDbManager; 
