
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const apiRoutes = require('./routes/api');
const Package = require('./models/Package');
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/auth');
const { startSerialIngest, stopSerialIngest } = require('./services/serialIngest');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/delivery_db';
const PORT = process.env.PORT || 5000;

const app = express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());

// Views (EJS)
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Connect to MongoDB (no deprecated options)
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

mongoose.connection.on('error', err => {
  console.error('Mongoose connection error:', err);
});

// Mount API routes under /api
app.use('/api', apiRoutes);

// Auth routes
app.use('/auth', authRoutes);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Label printing route - render a print-friendly label for a package
app.get('/label/:id', async (req, res) => {
  try {
    const pkg = await Package.findById(req.params.id).exec();
    if (!pkg) return res.status(404).send('Package not found');
    res.render('label', { pkg });
  } catch (err) {
    console.error('Label render error', err);
    res.status(500).send('Server error');
  }
});

// Note: server will be started after routes are defined (below)

// Import node-fetch (CommonJS version)
const fetch = require('node-fetch');

// Home/Landing Page Route
app.get('/', (req, res) => {
  res.render('home');
});

// Main Dashboard Route — renders `views/index.ejs` by fetching API data
app.get('/dashboard', async (req, res) => {
  try {
    // Fetch data directly from database instead of making HTTP requests
    const [packages, totalRevenue, avgWeight] = await Promise.all([
      Package.find().sort({ createdAt: -1 }).limit(10).exec(),
      Package.aggregate([{ $group: { _id: null, total: { $sum: '$fee' } } }]).exec(),
      Package.aggregate([{ $group: { _id: null, avg: { $avg: '$weight' } } }]).exec()
    ]);

    const totalPackages = await Package.countDocuments().exec();
    const revenue = totalRevenue.length > 0 ? totalRevenue[0].total : 0;
    const avgWt = avgWeight.length > 0 ? avgWeight[0].avg : 0;

    // Get chart data (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const chartData = await Package.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]).exec();

    res.render('index', {
      summary: { 
        totalPackages: totalPackages,
        totalRevenue: revenue,
        avgWeight: avgWt
      },
      recentPackages: packages,
      chart: chartData.map(d => ({ date: d._id, count: d.count }))
    });

  } catch (error) {
    // Log the error, but render the page with empty data so the frontend still works
    console.error('Failed to fetch dashboard data (falling back to empty data):', error && (error.stack || error));

    res.render('index', {
      summary: { totalPackages: 0, totalRevenue: 0, avgWeight: 0 },
      recentPackages: [],
      chart: []
    });
  }
});

// Quick render route for frontend checks (does not fetch API data)
app.get('/view', (req, res) => {
  res.render('index', {
    summary: { totalPackages: 0, totalRevenue: 0, avgWeight: 0 },
    recentPackages: [],
    chart: []
  });
});

// Serve a static test page for quick frontend checks
app.get('/frontend', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'frontend_test.html'));
});

// Start server (now that routes are registered)
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startSerialIngest();
});

function shutdown(signal) {
  console.log(`Received ${signal}, closing server...`);
  stopSerialIngest();
  server.close(err => {
    if (err) {
      console.error('Error closing server:', err);
      process.exit(1);
    } else {
      process.exit(0);
    }
  });

  setTimeout(() => {
    console.warn('Force exiting after timeout');
    process.exit(1);
  }, 5000).unref();
}

['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => shutdown(signal));
});
