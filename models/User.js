const mongoose = require('mongoose');
const { Schema } = mongoose;

const UserSchema = new Schema({
  companyName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  postalCode: { type: String, required: true },
  address: { type: String, required: true },
  machineCode: { type: String, unique: true, sparse: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
