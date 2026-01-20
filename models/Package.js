const mongoose = require('mongoose');
const { Schema } = mongoose;

const PackageSchema = new Schema({
  // Measurements from ESP32 / live feed
  weight: { type: Number, required: true },
  volume: { type: Number, required: true },
  feeType: { type: String, required: true },
  fee: { type: Number, required: true },

  // Item tracking
  itemNumber: { type: String },
  barcode: { type: String },
  status: { type: String, default: 'new' },

  // Delivery / customer details (may be filled later via Deliver Now)
  deliveryCompany: { type: String },
  customerName: { type: String },
  address: { type: String },
  postalCode: { type: String },
  phone: { type: String },
  email: { type: String },
  userId: { type: String },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Package', PackageSchema);
