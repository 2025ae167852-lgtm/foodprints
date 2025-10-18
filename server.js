/**
 * server.js - safe/robust server for Render (production)
 *
 * - Loads .env
 * - Serves EJS views from /views
 * - Serves multiple static directories if they exist
 * - Tolerant route loading (skips routes that throw on require)
 * - Only initializes optional services (email, uploads) if explicitly enabled
 * - Option A behavior: public landing; if user not logged in, show landing with admin_status=false
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

require('dotenv').config();

const CUSTOM_ENUMS = {
  PRODUCTION: 'production',
  DEVELOPMENT: 'development',
};

const app = express();

// -------------------------
// Views & statics
// -------------------------
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

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
  app.use(logger('common', { skip: (req, res) => res.statusCode < 400 }));
} else {
  app.use(logger('dev'));
}

// -------------------------
// Parsers & cookie
// -------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(cors());

// -------------------------
// Session & passport (minimal local file-based auth as repo expects)
// -------------------------
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-session-secret',
    resave: false,
    saveUninitialized: true,
    cookie: {
      maxAge: (parseInt(process.env.SESSION_TOKEN_LIFETIME || '3600', 10) || 3600) * 1000,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

// localdb expected by project; if missing it will throw — we wrap passport use in try/catch
let dbLocal;
try {
  dbLocal = require('./config/passport/localdb');
} catch (e) {
  console.warn('Warning: localdb not found or failed to load. File-based auth may be unavailable.', e.message || e);
  dbLocal = null;
}

if (dbLocal && dbLocal.users) {
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
} else {
  // fallback - minimal passport stubs so app doesn't crash if auth routes are skipped
  passport.serializeUser((user, cb) => cb(null, user ? user.id || user : null));
  passport.deserializeUser((id, cb) => cb(null, null));
}

// expose flash messages to views
app.use((req, res, next) => {
  res.locals.error = req.flash('error');
  res.locals.success = req.flash('success');
  next();
});

// -------------------------
// Database (Sequelize) - prefer DATABASE_URL if present
// -------------------------
let sequelize = null;
try {
  const databaseUrl = process.env.DATABASE_URL || null;
  if (databaseUrl) {
    const Sequelize = require('sequelize');
    sequelize = new Sequelize(databaseUrl, {
      dialectOptions:
        process.env.DB_SSL === 'true'
          ? { ssl: { require: true, rejectUnauthorized: false } }
          : {},
      logging: process.env.DB_LOGGING === 'true' ? console.log : false,
    });
  } else {
    // fallback to existing config module (repo has config/db/db_sequelise.js)
    const dbModulePath = path.join(__dirname, 'config', 'db', 'db_sequelise.js');
    if (fs.existsSync(dbModulePath)) {
      sequelize = require('./config/db/db_sequelise');
    } else {
      console.warn('No DATABASE_URL and config/db/db_sequelise.js missing — DB features disabled.');
    }
  }
} catch (e) {
  console.error('Sequelize init error:', e && e.message ? e.message : e);
}

(async function initDatabase() {
  if (!sequelize) return;
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected successfully');
    if (process.env.NODE_ENV !== CUSTOM_ENUMS.PRODUCTION) {
      try {
        await sequelize.sync();
        console.log('Database sync (dev) completed.');
      } catch (syncErr) {
        console.warn('Database sync (dev) warning:', syncErr && syncErr.message ? syncErr.message : syncErr);
      }
    } else {
      console.log('Production mode: skipping model sync.');
    }
  } catch (err) {
    console.error('Error connecting to database:', err && err.message ? err.message : err);
  }
})().catch(e => console.error('DB init unexpected error', e));

// -------------------------
// Optional: Email transport (only if explicitly enabled)
// -------------------------
let emailTransporter = null;
if (process.env.EMAIL_ENABLED === 'true') {
  try {
    const nodemailer = require('nodemailer');
    emailTransporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '587', 10),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_ADDRESS,
        pass: process.env.EMAIL_PASSWORD,
      },
      tls: { rejectUnauthorized: false },
    });
    emailTransporter.verify().then(() => console.log('Email transporter ready')).catch(e => console.error('Email verify failed:', e.message || e));
  } catch (e) {
    console.error('Email init error:', e && e.message ? e.message : e);
  }
} else {
  console.log('Email disabled (EMAIL_ENABLED not true).');
}

// -------------------------
// Safe route loader helper
// -------------------------
function tryRequireRoute(modulePath) {
  try {
    // use require.resolve to get helpful error if missing
    const resolved = require.resolve(modulePath);
    return require(resolved);
  } catch (err) {
    console.warn(`Route load failed: ${modulePath} - ${err.message || err}`);
    return null;
  }
}

// -------------------------
// Explicit mounts (keeps parity with your app)
// -------------------------
const mounts = [
  { file: './routes/config', path: '/app/config' },
  { file: './routes/harvest', path: '/app/harvest' },
  { file: './routes/storage', path: '/app/storage' },
  { file: './routes/auth', path: '/app/auth' },
  { file: './routes/blockchain', path: '/' },
  { file: './routes/dashboards', path: '/app/dashboards' },
  { file: './routes/qrcode', path: '/app' },
  { file: './routes/test', path: '/' },
  { file: './routes/search', path: '/' },
  { file: './routes/api_v1', path: '/app/api/v1' },
  { file: './routes/produce', path: '/app/produce' },
  { file: './routes/buyer', path: '/app/buyer' },
  { file: './routes/seller', path: '/app/seller' },
  { file: './routes/order', path: '/app/order' },
  { file: './routes/email', path: '/app/email' },
];

mounts.forEach(m => {
  const mod = tryRequireRoute(m.file);
  if (mod) {
    try {
      app.use(m.path, mod);
      console.log(`Mounted route ${m.file} -> ${m.path}`);
    } catch (e) {
      console.warn(`Skipping mount ${m.file} due to runtime error:`, e && e.message ? e.message : e);
    }
  }
});

// Auto-discover remaining route files (mount at /app/<name>) — skip ones already mounted
const routesDir = path.join(__dirname, 'routes');
if (fs.existsSync(routesDir)) {
  fs.readdirSync(routesDir)
    .filter(f => f.endsWith('.js'))
    .forEach(file => {
      const name = file.replace(/\.js$/, '');
      if (mounts.some(m => m.file.endsWith(name))) return;
      const modulePath = path.join(routesDir, file);
      const mod = tryRequireRoute(modulePath);
      if (mod) {
        try {
          app.use(`/app/${name}`, mod);
          console.log(`Auto-mounted /app/${name}`);
        } catch (e) {
          console.warn(`Auto-mount error for ${file}:`, e && e.message ? e.message : e);
        }
      }
    });
}

// -------------------------
// Root route: Option A (public landing)
// - Renders views/index.ejs if exists and provides admin_status
// -------------------------
app.get('/', (req, res) => {
  const indexViewPath = path.join(__dirname, 'views', 'index.ejs');
  const user = req.user || null;
  // admin_status true only when logged in and role matches Admin or Superuser
  const admin_status = user && (user.role === 'Admin' || user.role === 'Superuser');

  if (fs.existsSync(indexViewPath)) {
    return res.render('index', {
      user,
      admin_status: !!admin_status,
      page_name: 'home',
    });
  }

  // fallback: if static index exists, serve it
  const staticIndex = path.join(__dirname, 'foodprint-static', 'index.html');
  if (fs.existsSync(staticIndex)) return res.sendFile(staticIndex);

  return res.send('FoodPrint app is running.');
});

// -------------------------
// 404 + error handler
// -------------------------
app.use((req, res, next) => next(createError(404)));
app.use((err, req, res, next) => {
  res.locals.message = err.message;
  res.locals.error = process.env.NODE_ENV === CUSTOM_ENUMS.DEVELOPMENT ? err : {};
  res.status(err.status || 500);
  const errorView = path.join(__dirname, 'views', 'error.ejs');
  if (fs.existsSync(errorView)) {
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
  console.log(`🚀 FoodPrint Server is running on port ${PORT} (env=${process.env.NODE_ENV || 'development'})`);
  if (process.env.NODE_ENV !== CUSTOM_ENUMS.PRODUCTION) {
    console.log(`🌐 Access it at http://localhost:${PORT}`);
  }
});

module.exports = app;
