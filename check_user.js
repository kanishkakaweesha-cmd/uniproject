// Check user machine codes
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

async function checkUsers() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');
    
    const users = await User.find({}).select('email companyName machineCode');
    console.log('\n=== All Users ===');
    users.forEach(user => {
      console.log(`Email: ${user.email}`);
      console.log(`Company: ${user.companyName}`);
      console.log(`Machine Code: ${user.machineCode || 'NOT SET'}`);
      console.log('---');
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkUsers();
