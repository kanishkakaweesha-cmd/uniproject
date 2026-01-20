const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
require('dotenv').config();

// Routes & Services
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const Package = require('./models/Package');
const { startSerialIngest, stopSerialIngest } = require('./services/serialIngest');

// ======================
// ENV VARIABLES
// ======================
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not defined. Add it in Railway Variables.');
  process.exit(1);
}

// ======================
// APP INIT
// ======================
const app = express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());

// ======================
// VIEW ENGINE (EJS)
// ======================
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// ======================
// STATIC FILES
// ======================
app.use(express.static(path.join(__dirname, 'public')));

// ======================
// MONGODB CONNECTION
// ======================
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

mongoose.connection.on('error', err => {
  console.error('❌ Mongoose runtime error:', err);
});

// ======================
// ROUTES
// ======================
app.use('/api', apiRoutes);
app.use('/auth', authRoutes);

// ======================
// PAGES
// ======================

// Home page
app.get('/', (req, res) => {
  res.render('home');
});

// Dashboard (NO localhost fetch – DB direct)
app.get('/dashboard', async (req, res) => {
  try {
    const [recentPackages, revenueAgg, avgAgg] = await Promise.all([
      Package.find().sort({ createdAt: -1 }).limit(10),
      Package.aggregate([{ $group: { _id: null, total: { $sum: '$fee' } } }]),
      Package.aggregate([{ $group: { _id: null, avg: { $avg: '$weight' } } }])
    ]);

    const totalPackages = await Package.countDocuments();

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
    ]);

    res.render('index', {
      summary: {
        totalPackages,
        totalRevenue: revenueAgg[0]?.total || 0,
        avgWeight: avgAgg[0]?.avg || 0
      },
      recentPackages,
      chart: chartData
    });

  } catch (err) {
    console.error('❌ Dashboard error:', err);

    res.render('index', {
      summary: { totalPackages: 0, totalRevenue: 0, avgWeight: 0 },
      recentPackages: [],
      chart: []
    });
  }
});

// Label print page
app.get('/label/:id', async (req, res) => {
  try {
    const pkg = await Package.findById(req.params.id);
    if (!pkg) return res.status(404).send('Package not found');
    res.render('label', { pkg });
  } catch (err) {
    console.error('❌ Label error:', err);
    res.status(500).send('Server error');
  }
});

// Quick UI test
app.get('/view', (req, res) => {
  res.render('index', {
    summary: { totalPackages: 0, totalRevenue: 0, avgWeight: 0 },
    recentPackages: [],
    chart: []
  });
});

// Static frontend test
app.get('/frontend', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'frontend_test.html'));
});

// ======================
// START SERVER
// ======================
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  startSerialIngest();
});

// ======================
// GRACEFUL SHUTDOWN
// ======================
function shutdown(signal) {
  console.log(`⚠️ Received ${signal}, shutting down...`);
  stopSerialIngest();
  server.close(() => process.exit(0));

  setTimeout(() => {
    console.warn('⏰ Force exit');
    process.exit(1);
  }, 5000).unref();
}

['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => shutdown(signal));
});
