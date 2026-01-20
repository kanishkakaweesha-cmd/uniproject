const Package = require('../models/Package');

const sseClients = new Set();
let latestPayload = {
  weight: null,
  volume: null,
  price: null,
  feeType: null,
  timestamp: null,
  _id: null
};

function serializePackage(pkg) {
  if (!pkg) {
    return {
      weight: null,
      volume: null,
      price: null,
      feeType: null,
      timestamp: null,
      _id: null
    };
  }

  const plain = typeof pkg.toObject === 'function' ? pkg.toObject() : pkg;
  return {
    weight: typeof plain.weight === 'number' ? plain.weight : null,
    volume: typeof plain.volume === 'number' ? plain.volume : null,
    price: typeof plain.fee === 'number' ? plain.fee : null,
    feeType: plain.feeType ?? null,
    timestamp: plain.timestamp ?? null,
    _id: plain._id ? plain._id.toString() : null
  };
}

function writePayloadToClient(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcastLivePayload(payload) {
  latestPayload = {
    weight: typeof payload.weight === 'number' ? payload.weight : null,
    volume: typeof payload.volume === 'number' ? payload.volume : null,
    price: typeof payload.price === 'number' ? payload.price : null,
    feeType: payload.feeType ?? null,
    timestamp: payload.timestamp ?? new Date().toISOString(),
    _id: payload._id ?? null
  };

  for (const client of sseClients) {
    try {
      writePayloadToClient(client.res, latestPayload);
    } catch (err) {
      console.error('SSE broadcast error:', err);
    }
  }
}

function broadcastLivePackage(pkg) {
  const payload = serializePackage(pkg);
  if (!payload.timestamp) {
    payload.timestamp = new Date().toISOString();
  }
  broadcastLivePayload(payload);
}

function getLatestPayload() {
  return latestPayload;
}

async function sendInitialPayload(res) {
  if (latestPayload.weight !== null || latestPayload.volume !== null || latestPayload.price !== null) {
    writePayloadToClient(res, latestPayload);
    return;
  }

  try {
    const latest = await Package.findOne().sort({ timestamp: -1 }).limit(1).exec();
    const payload = serializePackage(latest);
    if (!payload.timestamp) {
      payload.timestamp = new Date().toISOString();
    }
    latestPayload = payload;
    writePayloadToClient(res, payload);
  } catch (err) {
    console.error('Initial SSE payload error:', err);
    writePayloadToClient(res, latestPayload);
  }
}

async function registerSseClient(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();
  res.write('retry: 5000\n\n');

  const client = { res };
  sseClients.add(client);

  const keepAliveTimer = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch (err) {
      clearInterval(keepAliveTimer);
      sseClients.delete(client);
    }
  }, 25000);

  await sendInitialPayload(res);

  req.on('close', () => {
    clearInterval(keepAliveTimer);
    sseClients.delete(client);
  });
}

module.exports = {
  broadcastLivePackage,
  broadcastLivePayload,
  getLatestPayload,
  registerSseClient,
  serializePackage
};
