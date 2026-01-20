// Script to add machine code to existing users
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

async function updateUsers() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');
    
    // Find users without machine code
    const users = await User.find({ machineCode: { $exists: false } });
    console.log(`Found ${users.length} users without machine code`);
    
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      // Assign machine code starting from ED00001
      const machineCode = 'ED' + String(i + 1).padStart(5, '0');
      user.machineCode = machineCode;
      await user.save();
      console.log(`Updated user ${user.email} with machine code ${machineCode}`);
    }
    
    console.log('All users updated successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

updateUsers();
