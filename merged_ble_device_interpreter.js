const noble = require('@abandonware/noble');

function interpretData(data) {
  const pack_type = data.readUInt8(0);
  let interpretedData = {};

  try {
    // Validate data length before proceeding
    if (data.length < 6) {
      console.log('Data length insufficient. Skipping packet.');
      return null;
    }

    if (data.length < 20) {
      console.log(`Data length is too short: ${data.length}`);
      return null;
    }

      if (pack_type === 1) {
        // ECG Data
        const data_id = data.readUInt16LE(1);
        const scale_code = data.readUInt8(3);
        let scale = scale_code > 100 ? 100 + (scale_code - 100) * 4 : scale_code;
        let ecg_values = [];
        ecg_values[0] = data.readInt16LE(4); // Reading signed 16-bit

        for (let n = 0; n < 13; n++) {
          ecg_values[n + 1] = ecg_values[n] + (data.readUInt8(6 + n) - 128) * scale;
        }

        const bpm_momentary = ecg_values[19];

        interpretedData = { data_id, scale, ecg_values, bpm_momentary };
      } else if (pack_type === 2) {
        // IMU+RR Data
        const ax = (data.readUInt16LE(1) - 2048) * 9.81 * (4.0 / 4096.0);
        const ay = (data.readUInt16LE(3) - 2048) * 9.81 * (4.0 / 4096.0);
        const az = (data.readUInt16LE(5) - 2048) * 9.81 * (4.0 / 4096.0);
        const dev_BPM = data.readUInt8(15);
        const dev_skin = data.readUInt16LE(16);

        interpretedData = { ax, ay, az, dev_BPM, dev_skin };
      } else if (pack_type === 3) {
        let pNN_short = [];
        const availableBytes = data.length - 1; // The first byte is pack_type

        // Make sure to read only as many bytes as are available
        for (let i = 0; i < Math.min(15, availableBytes); i++) {
          pNN_short.push(data.readUInt8(i + 1));
        }

        // Bit-shifting to get the values from bytes 16, 17, and 18
        const byte16 = data.readUInt8(16);
        const byte17 = data.readUInt8(17);
        const byte18 = data.readUInt8(18);
        const dev_SDRR = (byte16 << 4) + (byte17 >> 4);
        const dev_RMSSD = ((byte17 & 0xF) << 8) + byte18;

        // Battery value at byte 19
        const batt = data.readUInt8(19);

        console.log(`Battery data at byte 19: ${batt}`); // Debug statement

        interpretedData = { pNN_short, dev_SDRR, dev_RMSSD, batt };
      }

      console.log(`Interpreted data: ${JSON.stringify(interpretedData)}`);
      return interpretedData;
    } catch (error) {
      console.log(`Error interpreting data: ${error.message}`);
      return null;
    }
}

// Initialize noble
console.log('Initializing noble');
let connectedPeripheral = null;

noble.on('stateChange', function(state) {
  if (state === 'poweredOn') {
    noble.startScanning(['0000180D-0000-1000-8000-00805F9B34FB']);
  } else {
    noble.stopScanning();
  }
});

noble.on('discover', function(peripheral) {
  // Stop scanning once we find the peripheral we're looking for.
  noble.stopScanning();

  connectedPeripheral = peripheral;

  peripheral.connect(function(err) {
    if (err) {
      console.error('Connection Error:', err);
      return;
    }

    peripheral.once('disconnect', function() {
      console.log('Disconnected, scanning again...');
      connectedPeripheral = null;
      noble.startScanning(['0000180D-0000-1000-8000-00805F9B34FB']);
    });

    peripheral.discoverServices([], function (err, services) {
      services.forEach(function (service) {
        
        service.discoverCharacteristics([], function (err, characteristics) {
          characteristics.forEach(function (characteristic) {

            // Read data if the characteristic is readable
            if (characteristic.properties.includes('read')) {
              characteristic.read(function(err, data) {
                if (!err) {
                  const interpretedData = interpretData(data);  // Interpret the raw data
                  console.log(`Interpreted Read data: ${JSON.stringify(interpretedData)}`);
                }
              });
            }
            // Subscribe for notifications if the characteristic supports it
            if (characteristic.properties.includes('notify')) {
              characteristic.subscribe(function(err) {
                characteristic.on('data', function(data) {
                  const interpretedData = interpretData(data);  // Interpret the raw data
                  console.log(`Interpreted Notification data: ${JSON.stringify(interpretedData)}`);
                });
              });
            }
          });
        });
      });
    });
  });
});
