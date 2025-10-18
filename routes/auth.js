var express = require('express');
var router = express.Router();
var passport = require('passport');
var ROLES = require('../utils/roles');
const bcrypt = require('bcryptjs'); // ✅ USING bcryptjs for Render compatibility
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

var initModels = require('../models/init-models');
var sequelize = require('../config/db/db_sequelise');
var models = initModels(sequelize);



const {
  getUploadParams,
  resolveFilenames,
  uploadConnection,
} = require('../config/digitalocean/file-upload');

const { getMimeType } = require('../utils/image_mimetypes');
const uuidv4 = require('uuid/v4');
const BucketName = process.env.DO_BUCKET_NAME;

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const tw_client = require('twilio')(accountSid, authToken);

/* Render Login page. */
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', {
    title: 'FoodPrint - User Login',
    user: req.user,
    page_name: 'login'
  });
});

/* Process Login (DB Auth using bcryptjs) */
router.post('/dblogin', async (req, res) => {
  try {
    const user = await models.User.findOne({ where: { email: req.body.email } });
    if (!user) {
      req.flash('error', 'User not found');
      return res.redirect('/app/auth/login');
    }

    const isMatch = await bcrypt.compare(req.body.password, user.passwordHash);
    if (!isMatch) {
      req.flash('error', 'Invalid email or password');
      return res.redirect('/app/auth/login');
    }

    req.login(user, err => {
      if (err) throw err;
      return res.redirect('/');
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Login failed');
    res.redirect('/app/auth/login');
  }
});

/* Logout */
router.get('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    req.flash('success', 'You are now logged out.');
    res.redirect('/app/auth/login');
  });
});

/* Render Register page */
router.get('/register/:message?', (req, res) => {
  const isMessage = req.params.message;
  res.render(isMessage ? 'message' : 'register', {
    title: 'FoodPrint - User Registration',
    user: req.user,
    page_name: isMessage ? 'message' : 'register',
    message: isMessage
      ? 'Your registration has been submitted. You will be notified via email.'
      : null
  });
});

/* Register User (save hashed password) */
router.post('/register', async (req, res) => {
  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(req.body.password, salt);

    await models.User.create({
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      phoneNumber: req.body.phoneNumber,
      passwordHash: hash,
      role: ROLES.User,
      registrationChannel: 'web'
    });

    res.redirect('/app/auth/register/message');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Registration failed.');
    res.redirect('/app/auth/register');
  }
});

module.exports = router;
