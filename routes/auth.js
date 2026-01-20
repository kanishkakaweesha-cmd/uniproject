const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const COOKIE_NAME = 'token';

// Register
router.get('/register', (req, res) => {
  res.render('register');
});

router.post('/register', async (req, res) => {
  try {
    const { companyName, email, phone, postalCode, address, machineCode, password } = req.body;
    const errors = [];
    if (!companyName) errors.push('companyName is required');
    if (!email) errors.push('email is required');
    if (!phone) errors.push('phone is required');
    if (!postalCode) errors.push('postalCode is required');
    if (!address) errors.push('address is required');
    if (!password || password.length < 6) errors.push('password must be at least 6 characters');
    
    // Validate machine code format if provided: ED00001 to ED99999
    if (machineCode) {
      const machineCodeRegex = /^ED\d{5}$/;
      if (!machineCodeRegex.test(machineCode)) {
        errors.push('Machine code must be in format ED00001 to ED99999');
      } else {
        const numPart = parseInt(machineCode.substring(2));
        if (numPart < 1 || numPart > 99999) {
          errors.push('Machine code must be between ED00001 and ED99999');
        }
      }
    }
    
    if (errors.length) return res.status(400).json({ errors });

    const existing = await User.findOne({ email }).exec();
    if (existing) return res.status(400).json({ errors: ['Email already registered'] });
    
    if (machineCode) {
      const existingCode = await User.findOne({ machineCode }).exec();
      if (existingCode) return res.status(400).json({ errors: ['Machine code already registered'] });
    }

    // Auto-generate machine code if not provided
    let finalMachineCode = machineCode;
    if (!finalMachineCode) {
      const userCount = await User.countDocuments();
      finalMachineCode = 'ED' + String(userCount + 1).padStart(5, '0');
      
      // Check if generated code exists, find next available
      let codeExists = await User.findOne({ machineCode: finalMachineCode }).exec();
      let counter = userCount + 2;
      while (codeExists && counter <= 99999) {
        finalMachineCode = 'ED' + String(counter).padStart(5, '0');
        codeExists = await User.findOne({ machineCode: finalMachineCode }).exec();
        counter++;
      }
    }

    const hash = await bcrypt.hash(password, 10);
    const user = new User({ companyName, email, phone, postalCode, address, machineCode: finalMachineCode, passwordHash: hash });
    await user.save();
    return res.status(201).json({ message: 'Registered' });
  } catch (err) {
    console.error('Register error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.get('/login', (req, res) => {
  res.render('login');
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    
    const user = await User.findOne({ email }).exec();
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax' });
    return res.json({ message: 'Logged in' });
  } catch (err) {
    console.error('Login error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  return res.json({ message: 'Logged out' });
});

// Whoami
router.get('/me', async (req, res) => {
  try {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (!token) return res.json({ user: null });
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.id).select('-passwordHash').exec();
    return res.json({ user });
  } catch (err) {
    return res.json({ user: null });
  }
});

// Delete Account
router.delete('/account', async (req, res) => {
  try {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    
    const payload = jwt.verify(token, JWT_SECRET);
    const userId = payload.id;
    
    // Delete the user account
    const deletedUser = await User.findByIdAndDelete(userId).exec();
    
    if (!deletedUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Optional: Delete all packages associated with this user
    // Uncomment if you want to delete user's packages as well
    // const Package = require('../models/Package');
    // await Package.deleteMany({ deliveryCompany: deletedUser.companyName }).exec();
    
    // Clear the authentication cookie
    res.clearCookie(COOKIE_NAME);
    
    return res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    console.error('Delete account error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Restart Account - Clear all packages for the user
router.post('/restart', async (req, res) => {
  try {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    
    const payload = jwt.verify(token, JWT_SECRET);
    const userId = payload.id;
    
    // Get user information
    const user = await User.findById(userId).exec();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Delete all packages associated with this user
    const Package = require('../models/Package');
    const result = await Package.deleteMany({ 
      $or: [
        { userId: userId.toString() },
        { deliveryCompany: user.companyName }
      ]
    }).exec();
    
    return res.json({ 
      message: 'Account restarted successfully', 
      deletedPackages: result.deletedCount 
    });
  } catch (err) {
    console.error('Restart account error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
