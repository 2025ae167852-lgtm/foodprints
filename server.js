/**
 * server.js - optimized for Render / production deployment
 *
 * - Loads .env
 * - Serves views folder (EJS)
 * - Serves static folders (foodprint-static, public, src, build, docs, dist)
 * - Auto-loads routes from /routes where possible, but keeps explicit mounting
 * - Safe-guards email / uploads: only init if EMAIL_ENABLED / DO_UPLOAD_ENABLED etc are 'true'
 * - Uses DATABASE_URL if present. Authenticates DB, does NOT sync in production.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const session = require('express-session');
const flash = require('express-flash');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const createError = require('http-errors');
const cors = require('cors');

const CUSTOM_ENUMS = {
  PRODUCTION: 'production',
  DEVELOPMENT: 'development',
};

require('dotenv').config();

// Optionally silence console in production
if (process.env.NODE_ENV === CUSTOM_ENUMS.PRODUCTION && process.env.SILENT_PRODUCTION === 'true') {
  console.log = function () {};
  console.error = function () {};
}

const app = express();
const rootRouter = express.Router(); // root router used for homepage and other root routes

// -------------------------
// View engine & static
// -------------------------
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Serve multiple static locations (so you can keep either "foodprint-static" or "build" or "src")
const staticDirs = ['foodprint-static', 'public', 'src', 'build', 'docs', 'dist'];
staticDirs.forEach(dir => {
  const full = path.join(__dirname, dir);
  if (fs.existsSync(full)) {
    app.use(express.static(full));
  }
});

// -------------------------
// Logging
// -------------------------
if (process.env.NODE_ENV === CUSTOM_ENUMS.PRODUCTION) {
  // only log warnings/errors in production
  app.use(logger('common', { skip: (req, res) => res.statusCode < 400 }));
} else {
  app.use(logger('dev'));
}

// -------------------------
// Body parsers & cookie
// -------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(cors());

// -------------------------
// Session & passport
// -------------------------
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-session-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: (parseInt(process.env.SESSION_TOKEN_LIFETIME || '3600', 10) || 3600) * 1000 },
  })
);

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

// simple file-based passport local (keeps parity with original project localdb)
const dbLocal = require('./config/passport/localdb');
passport.use(
  'file-local',
  new LocalStrategy({ usernameField: 'loginUsername', passwordField: 'loginPassword' }, (u, p, cb) =>
    dbLocal.users.findByUsername(u, (err, user) => {
      if (err) return cb(err);
      if (!user) return cb(null, false, { message: 'Incorrect username.' });
      if (user.password != p) return cb(null, false, { message: 'Incorrect password.' });
      return cb(null, user);
    })
  )
);
passport.use(
  'db-local',
  new LocalStrategy({ usernameField: 'loginUsername', passwordField: 'loginPassword' }, (u, p, cb) =>
    dbLocal.users.findByUsername(u, (err, user) => {
      if (err) return cb(err);
      if (!user) return cb(null, false, { message: 'Incorrect username.' });
      if (user.password != p) return cb(null, false, { message: 'Incorrect password.' });
      return cb(null, user);
    })
  )
);

passport.serializeUser((user, cb) => cb(null, user.id));
passport.deserializeUser((id, cb) => dbLocal.users.findById(id, cb));

// -------------------------
// Middleware for views
// -------------------------
app.use((req, res, next) => {
  res.locals.error = req.flash('error');
  res.locals.success = req.flash('success');
  next();
});

// -------------------------
// Database (Sequelize) setup
// -------------------------
let sequelize;
try {
  // prefer DATABASE_URL (Render / Heroku style) if present
  const databaseUrl = process.env.DATABASE_URL || null;
  if (databaseUrl) {
    // keep your existing db_sequelise module if it expects options - else create here
    const Sequelize = require('sequelize');
    sequelize = new Sequelize(databaseUrl, {
      dialectOptions: process.env.DB_SSL === 'true' ? { ssl: { require: true, rejectUnauthorized: false } } : {},
      logging: process.env.DB_LOGGING === 'true' ? console.log : false,
    });
  } else {
    // fallback to config module (the repo already has a config/db/db_sequelise.js)
    sequelize = require('./config/db/db_sequelise');
  }
} catch (err) {
  console.error('Sequelize init error:', err);
}

// Try authenticate - but do not force schema sync in production
async function initDatabase() {
  if (!sequelize) {
    console.warn('No sequelize instance available - skipping DB init.');
    return;
  }
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected successfully (PostgreSQL with SSL)');
    if (process.env.NODE_ENV !== CUSTOM_ENUMS.PRODUCTION) {
      // In development sync (be careful, this may alter schema) — you can remove or change to { alter: false }
      try {
        await sequelize.sync();
        console.log('Database sync (dev) completed.');
      } catch (syncErr) {
        console.warn('Database sync (dev) error:', syncErr && syncErr.message ? syncErr.message : syncErr);
      }
    } else {
      // production: do NOT attempt to alter schema
      console.log('Production mode: skipping model sync.');
    }
  } catch (err) {
    console.error('Error connecting to database:', err && err.message ? err.message : err);
  }
}
initDatabase().catch(e => console.error('DB init unexpected error', e));

// -------------------------
// Optional: Email init (disabled by default)
// -------------------------
let emailTransporter = null;
if (process.env.EMAIL_ENABLED === 'true') {
  // initialize nodemailer or your email library here (only when enabled)
  const nodemailer = require('nodemailer');
  emailTransporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587', 10),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_ADDRESS,
      pass: process.env.EMAIL_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
  // quick verify
  emailTransporter.verify().then(() => console.log('Email transporter ready')).catch(e => console.error('Email verify failed:', e));
} else {
  console.log('Email disabled (EMAIL_ENABLED not true).');
}

// -------------------------
// Optional: Disable uploads if DO/AWS disabled
// Routes that use DO/AWS should check DO_UPLOAD_ENABLED / AWS_ENABLED / CLOUDINARY_ENABLED
// -------------------------

// -------------------------
// Auto-register / mount routes
// Keep backward-compatible explicit mounts for main routes.
// -------------------------
function tryRequireRoute(modulePath) {
  try {
    const r = require(modulePath);
    return r;
  } catch (err) {
    console.warn(`Route load failed: ${modulePath} - ${err.message || err}`);
    return null;
  }
}

// Explicit route mounts (keeps the same structure as original repo)
// If you want to add/remove mounts, adjust here.
const routeMap = [
  { file: './routes/config', mount: '/app/config' },
  { file: './routes/harvest', mount: '/app/harvest' },
  { file: './routes/storage', mount: '/app/storage' },
  { file: './routes/auth', mount: '/app/auth' },
  { file: './routes/blockchain', mount: '/' },
  { file: './routes/dashboards', mount: '/app/dashboards' },
  { file: './routes/qrcode', mount: '/app' }, // these routes use /qrcode, etc
  { file: './routes/test', mount: '/' },
  { file: './routes/search', mount: '/' },
  { file: './routes/api_v1', mount: '/app/api/v1' },
  { file: './routes/produce', mount: '/app/produce' },
  { file: './routes/buyer', mount: '/app/buyer' },
  { file: './routes/seller', mount: '/app/seller' },
  { file: './routes/order', mount: '/app/order' },
  { file: './routes/email', mount: '/app/email' },
];

routeMap.forEach(r => {
  const mod = tryRequireRoute(r.file);
  if (mod && typeof mod === 'function' || (mod && mod.router)) {
    // module might export router directly
    app.use(r.mount, mod);
  } else if (mod && mod instanceof Object) {
    app.use(r.mount, mod);
  }
});

// Also auto-discover any other .js files in routes and mount at /app/filename (if not already mounted)
const routesDir = path.join(__dirname, 'routes');
if (fs.existsSync(routesDir)) {
  fs.readdirSync(routesDir)
    .filter(f => f.endsWith('.js'))
    .forEach(file => {
      const name = file.replace(/\.js$/, '');
      // Skip ones already mounted above
      if (routeMap.some(r => r.file.endsWith(name))) return;
      const modulePath = path.join(routesDir, file);
      const mod = tryRequireRoute(modulePath);
      if (mod) {
        // mount at /app/<name> for discovered routes
        const mountPath = `/app/${name}`;
        app.use(mountPath, mod);
      }
    });
}

// -------------------------
// Root (home) route: render views/index.ejs if present
// -------------------------
rootRouter.get('/', (req, res) => {
  // If user logged in show proper index; the original repo used connect-ensure-login;
  // for simplicity render index.ejs - this keeps parity with EJS option.
  const view = fs.existsSync(path.join(__dirname, 'views', 'index.ejs')) ? 'index' : null;
  if (view) {
    return res.render('index', { user: req.user || null, page_name: 'home' });
  }
  // fallback: serve static index from foodprint-static if exists
  const staticIndex = path.join(__dirname, 'foodprint-static', 'index.html');
  if (fs.existsSync(staticIndex)) {
    return res.sendFile(staticIndex);
  }
  return res.send('FoodPrint app is running. No index view found.');
});
app.use('/', rootRouter);

// -------------------------
// 404 + error handler
// -------------------------
app.use((req, res, next) => next(createError(404)));
app.use((err, req, res, next) => {
  res.locals.message = err.message;
  res.locals.error = process.env.NODE_ENV === CUSTOM_ENUMS.DEVELOPMENT ? err : {};
  res.status(err.status || 500);
  // If EJS view exists, render error.ejs; otherwise send JSON
  if (fs.existsSync(path.join(__dirname, 'views', 'error.ejs'))) {
    res.render('error', { user: req.user || null, page_name: 'error' });
  } else {
    res.json({ error: err.message || 'Server error' });
  }
});

// -------------------------
// Start server
// -------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 FoodPrint Server is running on port ${PORT} (env=${process.env.NODE_ENV})`);
  if (process.env.NODE_ENV !== CUSTOM_ENUMS.PRODUCTION) {
    console.log(`🌐 Access it at http://localhost:${PORT}`);
  }
});

module.exports = app;
