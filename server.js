// server.js
// Main app bootstrap for FoodPrint (robust for Render / production).
// - Blockchain loading is disabled by default (enable via BLOCKCHAIN_ENABLED=true).
// - Optional modules (passport localdb, blockchain route) are tolerant if missing.

'use strict';

// Silence console in production except essential messages
if (process.env.NODE_ENV === 'production') {
  // Keep console.error visible for critical errors but suppress normal logs.
  console.log = function () {}; // suppress info logs
  // Keep console.error but route it - we keep it as-is to capture errors.
}

// Basic imports
const createError = require('http-errors');
const sslRedirect = require('heroku-ssl-redirect');
const express = require('express');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const flash = require('express-flash');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const CUSTOM_ENUMS = require('./utils/enums');

// Load env in non-prod
if (process.env.NODE_ENV !== CUSTOM_ENUMS.PRODUCTION) {
  require('dotenv').config();
}

// Sequelize bootstrap (will throw if misconfigured; handled below)
const sequelise = require('./config/db/db_sequelise');

// Try to load optional localdb for passport strategies
let dbLocal = null;
try {
  dbLocal = require('./config/passport/localdb');
  console.log('Local passport DB loader found.');
} catch (e) {
  console.error(
    'Warning: ./config/passport/localdb not found. Local auth strategies will be skipped.'
  );
  // provide a safe stub so code that references dbLocal.users doesn't crash
  dbLocal = { users: { findByUsername: (u, cb) => cb(null, null), findById: (id, cb) => cb(null, null) } };
}

// swagger config
const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Foodprint API',
    version: '1.0.0',
    description: 'Foodprint API to allow external apps to communicate with Foodprint',
    license: { name: 'Licensed Under MIT', url: 'https://github.com/FoodPrintLabs/foodprint/blob/master/LICENSE' },
    contact: { name: 'Foodprint Labs', url: 'https://github.com/FoodPrintLabs' },
  },
  servers: [{ url: 'http://localhost:3000', description: 'dev' }],
};
const swaggerOptions = { swaggerDefinition, apis: ['./routes/*.js'] };
const swaggerSpecs = swaggerJSDoc(swaggerOptions);

// create app
const app = express();

// mount routers list placeholders (some require files may be optional)
let configRouter, harvestRouter, storageRouter, authRouter, blockchainRouter;
let dashboardsRouter, qrCodeRouter, testRouter, searchRouter, apiV1Router;
let produceRouter, buyerRouter, sellerRouter, orderRouter, emailRouter;

try { configRouter = require('./routes/config'); } catch (e) { console.error('routes/config missing'); configRouter = express.Router(); }
try { harvestRouter = require('./routes/harvest'); } catch (e) { console.error('routes/harvest missing'); harvestRouter = express.Router(); }
try { storageRouter = require('./routes/storage'); } catch (e) { console.error('routes/storage missing'); storageRouter = express.Router(); }
try { authRouter = require('./routes/auth'); } catch (e) { console.error('routes/auth missing'); authRouter = express.Router(); }
try { dashboardsRouter = require('./routes/dashboards'); } catch (e) { dashboardsRouter = express.Router(); }
try { qrCodeRouter = require('./routes/qrcode'); } catch (e) { console.error('routes/qrcode missing'); qrCodeRouter = express.Router(); }
try { testRouter = require('./routes/test'); } catch (e) { testRouter = express.Router(); }
try { searchRouter = require('./routes/search'); } catch (e) { searchRouter = express.Router(); }
try { apiV1Router = require('./routes/api_v1'); } catch (e) { apiV1Router = express.Router(); }
try { produceRouter = require('./routes/produce'); } catch (e) { produceRouter = express.Router(); }
try { buyerRouter = require('./routes/buyer'); } catch (e) { buyerRouter = express.Router(); }
try { sellerRouter = require('./routes/seller'); } catch (e) { sellerRouter = express.Router(); }
try { orderRouter = require('./routes/order'); } catch (e) { orderRouter = express.Router(); }
try { emailRouter = require('./routes/email'); } catch (e) { emailRouter = express.Router(); }

// BLOCKCHAIN: load only if enabled
const blockchainEnabled = (process.env.BLOCKCHAIN_ENABLED || 'false').toLowerCase() === 'true';
if (blockchainEnabled) {
  try {
    blockchainRouter = require('./routes/blockchain');
    console.log('Blockchain routes enabled.');
  } catch (e) {
    console.error('BLOCKCHAIN_ENABLED=true but ./routes/blockchain not found or errored. Blockchain disabled.', e.message || e);
    blockchainRouter = express.Router();
  }
} else {
  console.log('Blockchain disabled by configuration (BLOCKCHAIN_ENABLED != true).');
  blockchainRouter = express.Router(); // harmless placeholder
  // provide a simple placeholder route that returns 501 if someone calls a blockchain endpoint
  blockchainRouter.use((req, res, next) => {
    // If path includes /app or /blockchain, we return not implemented
    if (req.path && req.path.includes('/blockchain')) {
      return res.status(501).json({ success: false, message: 'Blockchain features disabled on this deployment.' });
    }
    next();
  });
}

// enable ssl redirect for production-like envs
app.use(sslRedirect(['production']));

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// logging: create access log file and setup morgan
const accessLogStream = fs.createWriteStream(path.join(__dirname, 'access.log'), { flags: 'a' });
if (app.get('env') === CUSTOM_ENUMS.PRODUCTION) {
  // only log errors in production
  app.use(logger('common', { skip: (req, res) => res.statusCode < 400 }));
} else {
  app.use(logger('dev', { stream: accessLogStream }));
}

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(cors());

// session config (keep simple; update for multi-process in production)
app.use(session({
  secret: process.env.SESSION_SECRET || 'default_session_secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: parseInt(process.env.SESSION_TOKEN_LIFETIME || '3600000', 10) }, // ms
}));

// passport init
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

// make basic locals available in views
app.use((req, res, next) => {
  res.locals.error = req.flash('error');
  res.locals.success = req.flash('success');
  next();
});

// swagger UI
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

// Mount routers
app.use('/', router);
if (blockchainRouter) app.use('/', blockchainRouter);
app.use('/app/config', configRouter);
app.use('/app/auth', authRouter);
app.use('/app/harvest', harvestRouter);
app.use('/app/storage', storageRouter);
app.use('/app/produce', produceRouter);
app.use('/app/dashboards', dashboardsRouter);
app.use('/app/buyer', buyerRouter);
app.use('/app/seller', sellerRouter);
app.use('/app/order', orderRouter);
app.use('/app/email', emailRouter);
app.use('/', testRouter);
app.use('/', searchRouter);
app.use('/app/', qrCodeRouter);
app.use('/app/api/v1', apiV1Router);

// Serve multiple possible static folders (common variations)
const staticCandidates = ['src', 'build', 'foodprint-static', 'public', 'docs'];
staticCandidates.forEach(folderName => {
  const full = path.join(__dirname, folderName);
  if (fs.existsSync(full)) {
    app.use(express.static(full));
    console.log(`Serving static files from ${full}`);
  }
});

// --- Passport strategies: register only if dbLocal.users is present and looks real
if (dbLocal && dbLocal.users && typeof dbLocal.users.findByUsername === 'function') {
  try {
    passport.use('file-local', new LocalStrategy(
      { usernameField: 'loginUsername', passwordField: 'loginPassword' },
      function (username, password, cb) {
        dbLocal.users.findByUsername(username, function (err, user) {
          if (err) return cb(err);
          if (!user) return cb(null, false, { message: 'Incorrect username.' });
          if (user.password !== password) return cb(null, false, { message: 'Incorrect password.' });
          return cb(null, user);
        });
      }
    ));
    passport.use('db-local', new LocalStrategy(
      { usernameField: 'loginUsername', passwordField: 'loginPassword' },
      function (username, password, cb) {
        dbLocal.users.findByUsername(username, function (err, user) {
          if (err) return cb(err);
          if (!user) return cb(null, false, { message: 'Incorrect username.' });
          if (user.password !== password) return cb(null, false, { message: 'Incorrect password.' });
          return cb(null, user);
        });
      }
    ));

    passport.serializeUser(function (user, cb) { cb(null, user.id); });
    passport.deserializeUser(function (id, cb) {
      dbLocal.users.findById(id, function (err, user) { if (err) return cb(err); cb(null, user); });
    });

    console.log('Passport local strategies registered.');
  } catch (e) {
    console.error('Error registering passport strategies:', e && e.message ? e.message : e);
  }
} else {
  console.warn('Passport local strategies skipped due to missing localdb.');
}

// catch 404
app.use(function (req, res, next) {
  next(createError(404));
});

// home route (if login required, many routes use connect-ensure-login; those routes will function
// but if auth middleware is absent they'll fail. We left auth routes mounted above.)
router.get('/', function (req, res) {
  // If user object missing we render publicly accessible home
  try {
    const user = req.user || null;
    // if views/index.ejs missing we fallback to a static welcome page
    if (fs.existsSync(path.join(__dirname, 'views', 'index.ejs'))) {
      const admin_status = (user && (user.role === 'Admin' || user.role === 'Superuser'));
      res.render('index', { user, page_name: 'home', admin_status });
    } else {
      res.send('<h1>FoodPrint</h1><p>Welcome. Views not present on this deployment.</p>');
    }
  } catch (e) {
    console.error('Error rendering home:', e);
    res.status(500).send('Server error');
  }
});

// error handler
app.use(function (err, req, res, next) {
  console.error('Unhandled error:', err && (err.stack || err.message || err));
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  res.status(err.status || 500);
  if (fs.existsSync(path.join(__dirname, 'views', 'error.ejs'))) {
    res.render('error', { user: req.user, page_name: 'error' });
  } else {
    res.sendStatus(err.status || 500);
  }
});

// --- Database connect + server listen
sequelise.authenticate()
  .then(() => {
    console.log('✅ Database connected successfully (PostgreSQL).');
    return sequelise.sync(); // do not use force:true in production
  })
  .then(() => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`🚀 Server started on port ${PORT} (env=${process.env.NODE_ENV || 'development'})`);
      if (!blockchainEnabled) {
        console.log('Blockchain routes are currently disabled. Set BLOCKCHAIN_ENABLED=true to enable.');
      }
    });
  })
  .catch(err => {
    // Log DB errors but keep process alive (Render will restart if necessary)
    console.error('Database startup error:', err && (err.message || err));
    // still try to start server even if DB sync fails (useful for static pages)
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`🚀 Server started (DB not fully available) on port ${PORT}`);
    });
  });

module.exports = app;
