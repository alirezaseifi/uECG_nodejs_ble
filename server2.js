var lowpass_param = 0.2;
var express = require('express');
var app = express();
var bodyParser = require('body-parser');

const noble = require('@abandonware/noble');

var update_rate = 4;
var ecg_data_queue = [];
var ecg_data = initializeEcgData();
var history_data = initializeHistoryData();
var max_history_len = 12 * 3600 * update_rate;

// BLE Initialization
initializeBLE();

// ECG Data Endpoints
app.use(express.json());
app.get('/', (req, res) => res.sendFile(__dirname + '/ecg.html'));
app.get('/get-ecg-data', (req, res) => res.json(ecg_data_queue.slice(0, 1200)));
app.get('/get-ecg-object', (req, res) => res.json(ecg_data));
app.get('/get-params-history', (req, res) => res.json(getHistoryData(req)));
// Firmware Upload Endpoints
app.use(bodyParser.raw({ type: 'application/octet-stream', limit: '2mb' }));

app.listen(8080);

function initializeEcgData() {
    return {
        bpm: 0, data_id: 0, RR_id: -1, RR_cur: 0, RR_prev: 0,
        temperature: 0, skin_res: 0, battery_mv: 0,
        acc_x: 0, acc_y: 0, acc_z: 0,
        gyro_x: 0, gyro_y: 0, gyro_z: 0,
        steps: 0, steps_rate: 0, hrv_parameter: 1.0, ecg_values: []
    };
}

function initializeHistoryData() {
    return {
        bpm: [], hrv: [], gsr: [], step_rate: [], temp: [], batt: [],
        acc_x: [], acc_y: [], acc_z: [], gyro_x: [], gyro_y: [], gyro_z: [],
        rr_cur: [], rr_prev: [], ecg: [], rr: []
    };
}

function initializeBLE() {
    console.log('Initializing noble');
    noble.on('stateChange', state => {
        if (state === 'poweredOn') {
            noble.startScanning(['0000180D-0000-1000-8000-00805F9B34FB']);
        } else {
            noble.stopScanning();
        }
    });

    noble.on('discover', peripheral => {
        console.log('Found the uECG device');
        noble.stopScanning();
        handlePeripheral(peripheral);
    });
}

function handlePeripheral(peripheral) {
    peripheral.connect(err => {
        if (err) {
            console.error('Connection Error:', err);
            return;
        }
        peripheral.once('disconnect', () => {
            console.log('Disconnected, scanning again...');
            noble.startScanning(['0000180D-0000-1000-8000-00805F9B34FB']);
        });

        peripheral.discoverServices([], (err, services) => {
            services.forEach(service => {
                service.discoverCharacteristics([], (err, characteristics) => {
                    characteristics.forEach(characteristic => {
                        if (characteristic.properties.includes('read')) {
                            characteristic.read((err, data) => {
                                if (!err) {
                                    const interpretedData = interpretData(data);
                                    console.log(`Interpreted Read data: ${JSON.stringify(interpretedData)}`);
                                }
                            });
                        }
                        if (characteristic.properties.includes('notify')) {
                            characteristic.subscribe(err => {
                                characteristic.on('data', data => {
                                    const interpretedData = interpretData(data);
                                    console.log(`Interpreted Notification data: ${JSON.stringify(interpretedData)}`);
                                });
                            });
                        }
                    });
                });
            });
        });
    });
}

function interpretData(data) {
    if (!Buffer.isBuffer(data)) {
        console.error("Data is not a buffer");
        return;
    }

    const pack_type = data.readUInt8(0);
    let interpretedData = {};

    switch (pack_type) {
        case 1: // ECG Data
            interpretedData = interpretEcgData(data);
            break;
        case 2: // IMU+RR Data
            interpretedData = interpretImuRrData(data);
            break;
        case 3: // HRV Data
            interpretedData = interpretHrvData(data);
            break;
        default:
            console.error(`Unknown packet type: ${pack_type}`);
            break;
    }

    // Update global data
    for (const [key, value] of Object.entries(interpretedData)) {
        updateEcgData(key, value);
        updateHistoryData(key, value);
    }
    ecg_data_queue.push(interpretedData);
    return interpretedData;
}

function updateEcgData(key, value) {
    if (ecg_data.hasOwnProperty(key)) {
        ecg_data[key] = value;
    } else {
        console.error(`Invalid ECG data key: ${key}`);
    }
}

function updateHistoryData(key, value) {
    if (history_data.hasOwnProperty(key)) {
        history_data[key].unshift(value);
        if (history_data[key].length > max_history_len) {
            history_data[key].pop();
        }
    } else {
        console.error(`Invalid history data key: ${key}`);
    }
}


function getHistoryData(req) {
    const last_hist = req.query.hist_id ? parseInt(req.query.hist_id) : 0;
    const last_hist_rr = req.query.rr_hist_id ? parseInt(req.query.rr_hist_id) : 0;

    return {
        hist_pos: history_data.bpm.length,
        h_bpm: history_data.bpm.slice(-last_hist),
        h_hrv: history_data.hrv.slice(-last_hist),
        h_gsr: history_data.gsr.slice(-last_hist),
        h_step_rate: history_data.step_rate.slice(-last_hist),
        h_temp: history_data.temp.slice(-last_hist),
        h_batt: history_data.batt.slice(-last_hist),
        h_acc_x: history_data.acc_x.slice(-last_hist),
        h_acc_y: history_data.acc_y.slice(-last_hist),
        h_acc_z: history_data.acc_z.slice(-last_hist),
        h_gyro_x: history_data.gyro_x.slice(-last_hist),
        h_gyro_y: history_data.gyro_y.slice(-last_hist),
        h_gyro_z: history_data.gyro_z.slice(-last_hist),
        h_rr_cur: history_data.rr_cur.slice(-last_hist_rr),
        h_rr_prev: history_data.rr_prev.slice(-last_hist_rr)
    };
}

function interpretImuRrData(data) {
    // Extracting IMU and RR data based on expected packet structure
    let imuData = {
        ax: data.readInt16LE(1), // Accelerometer X
        ay: data.readInt16LE(3), // Accelerometer Y
        az: data.readInt16LE(5), // Accelerometer Z
        rr_interval: data.readUInt16LE(7) // RR interval
    };
    return imuData;
}

function interpretHrvData(data) {
    // Extracting HRV value
    let hrvValue = data.readUInt16LE(1); // HRV value at 2nd byte position
    return { hrvValue };
}

function updateGlobalData(interpretedData) {
    // Example: Updating bpm, acc_x, etc. in ecg_data
    if (interpretedData.ecgValues) {
        ecg_data.ecg_values = interpretedData.ecgValues;
        history_data.ecg.unshift(interpretedData.ecgValues);
    }
    if (interpretedData.ax !== undefined) {
        ecg_data.acc_x = interpretedData.ax;
        history_data.acc_x.unshift(interpretedData.ax);
    }
    // Similar updates for other data fields...

    ecg_data_queue.push(interpretedData); // Add new data to the queue
}

function interpretEcgData(data) {
    let ecgValues = [];
    // Assuming the ECG data starts at the 2nd byte and has a length of N
    // This is just an example, adjust according to your data format
    for (let i = 1; i < data.length; i++) {
        ecgValues.push(data.readUInt8(i));
    }
    return { ecgValues };
}