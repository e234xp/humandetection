"use strict";

const util = require("util");
const exec = util.promisify(require("child_process").exec);

const fs = require("fs");
const path = require('path');
const cluster = require("cluster");

// development
// global.__dirname = path.dirname(fs.realpathSync(process.mainModule.filename));
// webpack
global.__dirname = ".";

const airaAiLiveCaptureTaskManager = require(global.__dirname + "/service/airaAiLiveCaptureTaskManager");
const airaAiDbManager = require(global.__dirname + "/service/airaAiDbManager");


function messageHandler(msg) {
    const worker = this;
    global.airaAiLiveCaptureTaskManager.messageFromWorker(worker, msg);
}

async function generateWorkers(LICENSE_AVAIABLE_PROCESS_NUMBER) {
    return new Promise((resolve) => {
        const _ENABLE_ONE_PID_ONE_CORE = false;
        function putWorkerToSingleCore(w) {
            if (_ENABLE_ONE_PID_ONE_CORE) {
                exec("taskset -pc " + w.index + " " + w.process.pid, function (err, stdout, stderr) {
                    console.log(stdout);
                });
            }
        }

        global.airaAiWorkers = [];
        for (let nowNumber = 0; nowNumber < LICENSE_AVAIABLE_PROCESS_NUMBER; nowNumber++) {
            var newWorker = cluster.fork();
            newWorker.isAvaiable = true;
            newWorker.index = nowNumber;
            newWorker.on("message", messageHandler);
            global.airaAiWorkers.push(newWorker);

            putWorkerToSingleCore(newWorker);
        }

        cluster.on("exit", (workerToExit, code, signal) => {
            let newWorker = cluster.fork();
            newWorker.isAvaiable = true;
            newWorker.index = workerToExit.index;
            newWorker.on("message", messageHandler);

            global.airaAiWorkers = global.airaAiWorkers.filter(worker => worker.index != workerToExit.index);
            global.airaAiWorkers.push(newWorker);

            putWorkerToSingleCore(newWorker);
        });

        resolve({ mseeage: "ok" });
    });
}

async function generateFrEngine() {
    global.engineRootPath = global.__dirname + "/bin";

    // develop
    // global.airaAi = require(global.engineRootPath + "/airaedgeai.node")(global.engineRootPath, "detection2002.xml");

    // webpack
    // global.airaAi = require( global.engineRootPath + "/airaedgeai.node" )( global.engineRootPath, "detection2002.xml" );
    global.airaAi = require(global.engineRootPath + "/airaedgeai.node")(global.engineRootPath, "detection2002.xml");
}

async function startTaskManager() {
    return new Promise((resolve) => {
        global.airaAiLiveCaptureTaskManager = new airaAiLiveCaptureTaskManager();
        global.airaAiLiveCaptureTaskManager.startService();
        resolve({ mseeage: "ok" });
    });
}

async function startDbManager(cb) {
    return new Promise((resolve) => {
        global.airaAiDbManager = new airaAiDbManager();
        global.airaAiDbManager.startService();
        resolve({ mseeage: "ok" });
    });
}

async function startLiveCaptureWorkerProcess() {
    const airaAiLiveCaptureWorker = require("./service/airaAiLiveCaptureWorker");
    return new airaAiLiveCaptureWorker();
}

generateFrEngine();
if (cluster.isMaster) {
    async function startServiceWithWorkers() {
        await startDbManager();
        try { await generateWorkers(8); } catch (e) { }
        startTaskManager();
    }
    startServiceWithWorkers();
}
else {
    global.faceCaptureWorker = startLiveCaptureWorkerProcess();
}

