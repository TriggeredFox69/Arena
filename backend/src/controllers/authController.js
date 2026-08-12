const { validationResult } = require('express-validator');
const User = require('../models/User');
const { generateToken } = require('../utils/jwt');
const { recordActivity } = require('../utils/activity');

exports.register = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { username, email, phone, password } = req.body;

    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email address is already registered'
      });
    }

    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({
        success: false,
        message: 'Username is already taken'
      });
    }

    if (phone && phone.trim()) {
      const existingPhone = await User.findOne({ phone: phone.trim() });
      if (existingPhone) {
        return res.status(400).json({
          success: false,
          message: 'Phone number is already registered'
        });
      }
    }

    const user = await User.create({
      username,
      email,
      phone: phone || null,
      password
    });

    const token = generateToken(user._id);

    recordActivity(user.id, 'register', {
      username: user.username,
      email: user.email,
      method: 'email'
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      token,
      user: user.getPublicProfile()
    });
  } catch (error) {
    if (error && error.message && error.message.includes('unique constraint')) {
      if (error.message.includes('username')) {
        return res.status(400).json({ success: false, message: 'Username is already taken' });
      }
      if (error.message.includes('email')) {
        return res.status(400).json({ success: false, message: 'Email is already registered' });
      }
      if (error.message.includes('phone')) {
        return res.status(400).json({ success: false, message: 'Phone number is already registered' });
      }
    }
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, username, password } = req.body;
    const loginIdentifier = (email || username || '').trim();

    if (!loginIdentifier) {
      return res.status(400).json({
        success: false,
        message: 'Email or username is required'
      });
    }

    let user = await User.findOne({ email: loginIdentifier });
    if (!user) {
      user = await User.findOne({ username: loginIdentifier });
    }
    if (!user) {
      user = await User.findOne({ phone: loginIdentifier });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email/username or password'
      });
    }

    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email/username or password'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account has been deactivated'
      });
    }

    const token = generateToken(user._id);

    recordActivity(user.id, 'login', {
      username: user.username,
      email: user.email,
      method: 'email'
    });

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: user.getPublicProfile()
    });
  } catch (error) {
    next(error);
  }
};

exports.getMe = async (req, res, next) => {
  try {
    res.json({
      success: true,
      user: req.user.getPublicProfile()
    });
  } catch (error) {
    next(error);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { username, phone } = req.body;
    const updateFields = {};

    if (username) updateFields.username = username;
    if (phone) updateFields.phone = phone;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateFields,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: user.getPublicProfile()
    });
  } catch (error) {
    next(error);
  }
};
