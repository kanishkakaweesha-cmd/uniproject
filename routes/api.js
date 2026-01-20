const express = require('express');
const router = express.Router();
const Package = require('../models/Package');
const { requireAuth } = require('../middleware/auth');
const {
  broadcastLivePackage,
  broadcastLivePayload,
  getLatestPayload,
  registerSseClient,
  serializePackage
} = require('../services/liveStream');
const ESP32_API_KEY = (process.env.ESP32_API_KEY || '').trim();
const ESP32_COMPANY_NAME = (process.env.ESP32_COMPANY_NAME || '').trim();

function requireAuthOrApiKey(req, res, next) {
  const headerKey = (req.get('x-api-key') || '').trim();
  const queryKey = (req.query && req.query.apiKey ? String(req.query.apiKey) : '').trim();

  if (ESP32_API_KEY && (headerKey === ESP32_API_KEY || queryKey === ESP32_API_KEY)) {
    req.isEsp32Device = true;
    return next();
  }

  return requireAuth(req, res, next);
}

// ESP32 endpoint: create a package
// Create a package (from ESP32 or UI)
// Protected create package: requires authenticated user
// Create a package (from ESP32 or UI)
// Protected create package: requires authenticated user
router.post('/packages', requireAuthOrApiKey, async (req, res) => {
  const {
    weight, volume, feeType, fee,
    customerName, address, postalCode, phone, email, itemNumber
  } = req.body;

  // Basic validation for measurements
  const parsedWeight = Number(weight);
  const parsedVolume = Number(volume);
  const parsedFee = Number(fee);
  const errors = [];

  if (!feeType || typeof feeType !== 'string') errors.push('feeType is required and must be a string');
  if (!Number.isFinite(parsedWeight)) errors.push('weight is required and must be a number');
  if (!Number.isFinite(parsedVolume)) errors.push('volume is required and must be a number');
  if (!Number.isFinite(parsedFee)) errors.push('fee is required and must be a number');

  if (errors.length) return res.status(400).json({ errors });

  try {
    // Use authenticated user's company and id (if available)
    const deliveryCompany = req.user && req.user.companyName
      ? req.user.companyName
      : (req.isEsp32Device && ESP32_COMPANY_NAME ? ESP32_COMPANY_NAME : undefined);
    const userId = req.user ? req.user._id.toString() : undefined;

    const pkg = new Package({
      weight: parsedWeight,
      volume: parsedVolume,
      feeType,
      fee: parsedFee,
      deliveryCompany,
      customerName,
      address,
      postalCode,
      phone,
      email,
      itemNumber,
      userId
    });
    const saved = await pkg.save();
    broadcastLivePackage(saved);
    return res.status(201).json(saved);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// Mark an existing package as ready for delivery by filling customer details
router.post('/packages/:id/deliver', requireAuth, async (req, res) => {
  const { customerName, phone, address, postalCode, email } = req.body;
  const errors = [];
  if (!customerName || typeof customerName !== 'string') errors.push('customerName is required');
  if (!phone || typeof phone !== 'string') errors.push('phone is required');
  if (!address || typeof address !== 'string') errors.push('address is required');

  if (errors.length) return res.status(400).json({ errors });

  try {
    const pkg = await Package.findById(req.params.id).exec();
    if (!pkg) return res.status(404).json({ error: 'Package not found' });

    // Populate company info from authenticated user
    const deliveryCompany = req.user.companyName;
    pkg.deliveryCompany = deliveryCompany;
    pkg.userId = req.user._id.toString();

    // Fill in delivery/customer fields
    pkg.customerName = customerName;
    pkg.phone = phone;
    pkg.address = address;
    pkg.postalCode = postalCode || pkg.postalCode;
    pkg.email = email || pkg.email;
    pkg.status = 'delivered';

    // Ensure barcode exists - use package id if not provided
    if (!pkg.barcode) {
      pkg.barcode = pkg._id.toString();
    }

    // Ensure itemNumber exists - fallback to timestamp if missing
    if (!pkg.itemNumber) {
      pkg.itemNumber = String(Math.floor(Date.now() / 1000));
    }

    const saved = await pkg.save();
    return res.json(saved);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// List all packages (optionally paginated)
router.get('/packages', async (req, res) => {
  try {
    const packages = await Package.find().sort({ timestamp: -1 }).limit(100).exec();
    return res.json(packages);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Live Feed endpoint: 10 most recent packages
router.get('/packages/recent', async (req, res) => {
  try {
    const recent = await Package.find().sort({ timestamp: -1 }).limit(10).exec();
    return res.json(recent);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Get package by id
router.get('/packages/:id', async (req, res) => {
  try {
    const pkg = await Package.findById(req.params.id).exec();
    if (!pkg) return res.status(404).json({ error: 'Package not found' });
    return res.json(pkg);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// KPI Card endpoint: summary (totalPackages, totalRevenue, avgWeight)
router.get('/dashboard/summary', async (req, res) => {
  try {
    const agg = await Package.aggregate([
      {
        $group: {
          _id: null,
          totalPackages: { $sum: 1 },
          totalRevenue: { $sum: '$fee' },
          avgWeight: { $avg: '$weight' }
        }
      },
      {
        $project: { _id: 0, totalPackages: 1, totalRevenue: 1, avgWeight: 1 }
      }
    ]);

    return res.json(agg[0] || { totalPackages: 0, totalRevenue: 0, avgWeight: 0 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Live Feed endpoint: 10 most recent packages
router.get('/packages/recent', async (req, res) => {
  try {
    const recent = await Package.find().sort({ timestamp: -1 }).limit(10).exec();
    return res.json(recent);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Pie Chart endpoint: group by feeType and return counts
router.get('/dashboard/chart', async (req, res) => {
  try {
    const chart = await Package.aggregate([
      { $group: { _id: '$feeType', count: { $sum: 1 } } }
    ]);
    return res.json(chart);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Delete a package by ID
router.delete('/packages/:id', requireAuth, async (req, res) => {
  try {
    const pkg = await Package.findById(req.params.id).exec();
    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }
    
    await Package.findByIdAndDelete(req.params.id).exec();
    return res.json({ message: 'Package deleted successfully', id: req.params.id });
  } catch (err) {
    console.error('Delete package error', err);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/esp32/stream', async (req, res) => {
  await registerSseClient(req, res);
});

// Get latest ESP32 data (most recent package)
router.get('/esp32/latest', async (req, res) => {
  try {
    const latestLive = getLatestPayload();
    if (
      latestLive &&
      (latestLive.weight !== null || latestLive.volume !== null || latestLive.price !== null)
    ) {
      return res.json({
        weight: latestLive.weight,
        volume: latestLive.volume,
        price: latestLive.price,
        timestamp: latestLive.timestamp,
        feeType: latestLive.feeType || null
      });
    }

    const latestPackage = await Package.findOne()
      .sort({ timestamp: -1 })
      .select('weight volume fee timestamp feeType')
      .limit(1)
      .exec();

    if (!latestPackage) {
      return res.json({
        weight: null,
        volume: null,
        price: null,
        timestamp: null,
        message: 'No data available'
      });
    }

    const payload = serializePackage(latestPackage);
    broadcastLivePayload(payload);
    return res.json({
      weight: payload.weight,
      volume: payload.volume,
      price: payload.price,
      timestamp: payload.timestamp,
      feeType: payload.feeType
    });
  } catch (err) {
    console.error('Get latest ESP32 data error', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
