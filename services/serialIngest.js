const { SerialPort } = require('serialport');
const Package = require('../models/Package');
const {
  broadcastLivePackage,
  broadcastLivePayload,
  getLatestPayload
} = require('./liveStream');

const SERIAL_PATH = (process.env.SERIAL_PORT_PATH || '').trim();
const SERIAL_BAUD_RATE = Number.parseInt(process.env.SERIAL_BAUD_RATE || '9600', 10) || 9600;
const SERIAL_ENABLED = process.env.SERIAL_INGEST_ENABLED !== 'false';
const SERIAL_REOPEN_DELAY_MS = Number.parseInt(process.env.SERIAL_REOPEN_DELAY_MS || '5000', 10) || 5000;
const MIN_PERSIST_INTERVAL_MS = Number.parseInt(process.env.SERIAL_MIN_PERSIST_MS || '15000', 10) || 15000;
const WEIGHT_DIFF_THRESHOLD = Number(process.env.SERIAL_WEIGHT_DIFF || '0.05');
const VOLUME_DIFF_THRESHOLD = Number(process.env.SERIAL_VOLUME_DIFF || '5');
const PRICE_DIFF_THRESHOLD = Number(process.env.SERIAL_PRICE_DIFF || '0.5');

const DELIVERY_COMPANY = (process.env.SERIAL_DELIVERY_COMPANY || process.env.ESP32_COMPANY_NAME || 'ESP32 Device').trim() || undefined;

let port = null;
let reopenTimer = null;
let buffer = '';
let currentMeasurement = resetMeasurement();
let lastPersistedKey = null;
let lastPersistedAt = 0;
let isStarting = false;

function resetMeasurement() {
  return {
    weight: null,
    volume: null,
    price: null,
    feeType: null
  };
}

function parseNumber(value) {
  if (value === undefined || value === null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function createMeasurementKey(measurement) {
  const parts = [measurement.weight, measurement.volume, measurement.price, measurement.feeType]
    .map(value => (value === null || value === undefined) ? 'null' : (typeof value === 'number' ? value.toFixed(2) : value));
  return parts.join('|');
}

function numbersDiffer(a, b, threshold) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return Math.abs(a - b) >= threshold;
}

function isSignificantChange(previous, current) {
  if (!previous) return true;
  const weightChanged = numbersDiffer(previous.weight, current.weight, WEIGHT_DIFF_THRESHOLD);
  const volumeChanged = numbersDiffer(previous.volume, current.volume, VOLUME_DIFF_THRESHOLD);
  const priceChanged = numbersDiffer(previous.price, current.price, PRICE_DIFF_THRESHOLD);
  const feeTypeChanged = (previous.feeType || null) !== (current.feeType || null);
  return weightChanged || volumeChanged || priceChanged || feeTypeChanged;
}

function handleLine(rawLine) {
  if (!rawLine) return;
  const line = rawLine.trim();
  if (!line) return;

  let match = line.match(/(?:Average\s+)?Weight:\s*(-?\d+(?:\.\d+)?)/i);
  if (match) {
    currentMeasurement.weight = parseNumber(match[1]);
  }

  match = line.match(/(?:Average\s+)?Volume:\s*(-?\d+(?:\.\d+)?)/i);
  if (match) {
    currentMeasurement.volume = parseNumber(match[1]);
  }

  match = line.match(/Fee:\s*Rs\.?\s*(-?\d+(?:\.\d+)?)/i);
  if (match) {
    currentMeasurement.price = parseNumber(match[1]);
  }

  match = line.match(/T\s*=?\s*([A-Z])/i);
  if (match) {
    currentMeasurement.feeType = match[1].toUpperCase();
  }

  if (currentMeasurement.price !== null && currentMeasurement.weight !== null && currentMeasurement.volume !== null) {
    finalizeMeasurement();
  }
}

function finalizeMeasurement() {
  const measurement = { ...currentMeasurement };
  currentMeasurement = resetMeasurement();

  if (!Number.isFinite(measurement.weight) || !Number.isFinite(measurement.volume) || !Number.isFinite(measurement.price)) {
    return;
  }

  if (!measurement.feeType) {
    measurement.feeType = null;
  }

  const timestamp = new Date().toISOString();
  const previous = getLatestPayload();
  const payload = {
    weight: measurement.weight,
    volume: measurement.volume,
    price: measurement.price,
    feeType: measurement.feeType,
    timestamp
  };

  broadcastLivePayload(payload);
  maybePersistMeasurement(payload, previous).catch(err => {
    console.error('Serial ingestion persist error:', err);
  });
}

async function maybePersistMeasurement(payload, previous) {
  if (!isSignificantChange(previous, payload)) {
    const withinThrottle = Date.now() - lastPersistedAt < MIN_PERSIST_INTERVAL_MS;
    if (withinThrottle) {
      return;
    }
  }

  const key = createMeasurementKey(payload);
  if (key === lastPersistedKey && Date.now() - lastPersistedAt < MIN_PERSIST_INTERVAL_MS) {
    return;
  }

  lastPersistedKey = key;
  lastPersistedAt = Date.now();

  try {
    const pkg = new Package({
      weight: payload.weight,
      volume: payload.volume,
      feeType: payload.feeType || 'U',
      fee: payload.price,
      deliveryCompany: DELIVERY_COMPANY
    });
    pkg.timestamp = new Date(payload.timestamp);
    const saved = await pkg.save();
    broadcastLivePackage(saved);
  } catch (err) {
    console.error('Failed to persist serial measurement:', err);
  }
}

function handleData(chunk) {
  buffer += chunk.toString('utf8');
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || '';
  for (const line of lines) {
    handleLine(line);
  }
}

function scheduleReopen() {
  if (reopenTimer) return;
  reopenTimer = setTimeout(() => {
    reopenTimer = null;
    openPort();
  }, SERIAL_REOPEN_DELAY_MS);
}

function openPort() {
  if (!port) return;
  if (port.isOpen || isStarting) return;
  isStarting = true;
  port.open(err => {
    isStarting = false;
    if (err) {
      console.error(`Serial port open error (${SERIAL_PATH}):`, err.message || err);
      scheduleReopen();
      return;
    }
    console.log(`Serial port opened on ${SERIAL_PATH} @ ${SERIAL_BAUD_RATE} baud`);
  });
}

function attachPortEventHandlers() {
  if (!port) return;
  port.on('data', handleData);
  port.on('error', err => {
    console.error('Serial port error:', err.message || err);
    scheduleReopen();
  });
  port.on('close', () => {
    console.warn('Serial port closed');
    scheduleReopen();
  });
}

function startSerialIngest() {
  if (!SERIAL_ENABLED) {
    console.log('Serial ingestion disabled via SERIAL_INGEST_ENABLED=false');
    return;
  }

  if (!SERIAL_PATH) {
    console.log('Serial ingestion not started: SERIAL_PORT_PATH env var is not set.');
    return;
  }

  if (port) {
    console.log('Serial ingestion already running.');
    return;
  }

  try {
    port = new SerialPort({
      path: SERIAL_PATH,
      baudRate: SERIAL_BAUD_RATE,
      autoOpen: false
    });
  } catch (err) {
    console.error('Failed to initialise serial port:', err.message || err);
    return;
  }

  attachPortEventHandlers();
  openPort();
}

function stopSerialIngest() {
  if (!port) return;
  try {
    port.removeAllListeners('data');
    port.removeAllListeners('error');
    port.removeAllListeners('close');
    if (port.isOpen) {
      port.close();
    }
  } catch (err) {
    console.error('Error while stopping serial ingestion:', err.message || err);
  } finally {
    port = null;
  }
}

module.exports = {
  startSerialIngest,
  stopSerialIngest
};
