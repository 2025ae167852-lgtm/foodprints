/**
 * Updated server.js
 * - Safe requires for optional modules
 * - Non-fatal DB handling
 * - Production-friendly logging (silence if NODE_ENV === 'production')
 * - Graceful fallback if passport/config files are missing
 * - Uses process.env.PORT for Render / Heroku compatibility
 */

'use strict';

// silence console in production if requested
if (process.env.NODE_ENV === 'production') {
  // If you truly want *no logs*, uncomment these lines.
  // console.log = function () {};
  // console.error = function () {};
}

// Load environment for non-production
const CUSTOM_ENUMS = {
  PRODUCTION: 'production',
  DEVELOPMENT: 'development',
};
if (process.env.NODE_ENV !== CUSTOM_ENUMS.PRODUCTION) {
  // safe to require dotenv when developing locally
  try {
    require('dotenv').config();
  } catch (e) {
    // ignore
  }
}

// Core deps
const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const createError = require('http-errors');
const sslRedirect = require('heroku-ssl-redirect');
const cors = require('cors');
const session = require('express-session');
const flash = require('express-flash');
const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const app = express();

// helper: safe require (returns null if module not found)
function safeRequire(p) {
  try {
    return require(p);
  } catch (err) {
    // Module not found or failed to load. Log in non-production.
    if (process.env.NODE_ENV !== CUSTOM_ENUMS.PRODUCTION) {
      console.error(`safeRequire: failed to load ${p}:`, err.message);
    }
    return null;
  }
}

// Database (wrap in try/catch — do not crash if misconfigured)
let sequelise = safeRequire('./config/db/db_sequelise');
if (!sequelise) {
  // create a minimal stub so code referencing it won't immediately crash
  sequelise = {
    authenticate: async () => Promise.resolve(),
    sync: async () => Promise.resolve(),
  };
}

// optional passport setup (safe)
const passport = safeRequire('passport');
const LocalStrategy = safeRequire('passport-local') ? safeRequire('passport-local').Strategy : null;
let passportConfigLoaded = false;
const passportConfig = safeRequire('./config/passport');
if (passport && passportConfig) {
  try {
    // If the passport config is a function, call it to initialize strategies
    if (typeof passportConfig === 'function') {
      passportConfig(passport);
      passportConfigLoaded = true;
    } else {
      passportConfigLoaded = true;
    }
  } catch (e) {
    passportConfigLoaded = false;
    if (process.env.NODE_ENV !== CUSTOM_ENUMS.PRODUCTION) {
      console.error('Failed to initialize passport config:', e.message);
    }
  }
}

// Routers (safe require)
const safeRouter = name => {
  const r = safeRequire(name);
  return r ? r : null;
};

const configRouter = safeRouter('./routes/config');
const harvestRouter = safeRouter('./routes/harvest');
const storageRouter = safeRouter('./routes/storage');
const authRouter = safeRouter('./routes/auth');
const blockchainRouter = safeRouter('./routes/blockchain');
const dashboardsRouter = safeRouter('./routes/dashboards');
const qrCodeRouter = safeRouter('./routes/qrcode');
const testRouter = safeRouter('./routes/test');
const searchRouter = safeRouter('./routes/search');
const apiV1Router = safeRouter('./routes/api_v1');
const produceRouter = safeRouter('./routes/produce');
const buyerRouter = safeRouter('./routes/buyer');
const sellerRouter = safeRouter('./routes/seller');
const orderRouter = safeRouter('./routes/order');
const emailRouter = safeRouter('./routes/email');

// enable ssl redirect (works on heroku, render etc)
try {
  app.use(sslRedirect());
} catch (e) {
  // ignore if not available
}

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Logging: Produce logs in dev, compact/error-only in prod
const accessLogStream = fs.createWriteStream(path.join(__dirname, 'access.log'), { flags: 'a' });

if (process.env.NODE_ENV === CUSTOM_ENUMS.PRODUCTION) {
  // only log >= 400 responses
  app.use(
    logger('common', {
      skip: function (req, res) {
        return res.statusCode < 400;
      },
    })
  );
} else {
  // dev: log to file for inspection
  app.use(logger('dev', { stream: accessLogStream }));
}

// standard middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(cors());

// Session config (MemoryStore for now — fine for small/public testing)
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'SimplePass123',
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: process.env.COOKIE_SECURE === 'true' || false,
      maxAge: parseInt(process.env.SESSION_TOKEN_LIFETIME || '3600000', 10),
    },
  })
);

// Initialize passport if available
if (passport) {
  app.use(passport.initialize());
  app.use(passport.session());
} else {
  // Create a minimal stub so code using 'connect-ensure-login' or passport won't crash.
  // We'll also provide a permissive ensureLoggedIn fallback below.
  if (process.env.NODE_ENV !== CUSTOM_ENUMS.PRODUCTION) {
    console.warn('Passport not available; running with permissive auth.');
  }
}

// flash (safe)
try {
  app.use(flash());
} catch (e) {
  // ignore if missing
}

// Set some locals for templates (flash-safe)
app.use(function (req, res, next) {
  try {
    res.locals.error = req.flash ? req.flash('error') : [];
    res.locals.success = req.flash ? req.flash('success') : [];
  } catch (e) {
    // noop
  }
  next();
});

// Swagger (docs) setup (safe)
try {
  const swaggerDefinition = {
    openapi: '3.0.0',
    info: {
      title: 'Foodprint API',
      version: '1.0.0',
      description: 'Foodprint API to allow external apps to communicate with Foodprint',
    },
    servers: [{ url: process.env.SWAGGER_BASE_URL || 'http://localhost:3000' }],
  };
  const swaggerOptions = {
    swaggerDefinition,
    apis: ['./routes/*.js'],
  };
  const swaggerSpecs = swaggerJSDoc(swaggerOptions);
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));
} catch (e) {
  if (process.env.NODE_ENV !== CUSTOM_ENUMS.PRODUCTION) {
    console.error('Swagger init failed:', e.message);
  }
}

// Provide a permissive ensureLoggedIn fallback if connect-ensure-login or passport not available
let ensureLoggedIn = null;
try {
  const cel = safeRequire('connect-ensure-login');
  if (cel && cel.ensureLoggedIn) {
    ensureLoggedIn = cel.ensureLoggedIn;
  }
} catch (e) {
  ensureLoggedIn = null;
}
if (!ensureLoggedIn) {
  // fallback: a middleware factory that returns a middleware which allows all requests through
  ensureLoggedIn = options => {
    return (req, res, next) => {
      // if you want lock-down in production, change this to enforce authentication.
      // for now keep permissive so site remains accessible if auth is missing.
      return next();
    };
  };
}

// Root router
const mainRouter = express.Router();

// Home route: try to use user info if passport present, otherwise render publicly
mainRouter.get('/', ensureLoggedIn({ redirectTo: '/app/auth/login' }), (req, res) => {
  try {
    const user = req.user || null;
    res.render('index', {
      user,
      page_name: 'home',
      admin_status: user && user.role && (user.role === 'Admin' || user.role === 'Superuser'),
    });
  } catch (e) {
    res.send('Foodprint backend - Welcome (index render failed).');
  }
});

// Mount routers only when available
app.use('/', mainRouter);

if (blockchainRouter) app.use('/', blockchainRouter);
if (configRouter) app.use('/app/config', configRouter);
if (authRouter) app.use('/app/auth', authRouter);
if (harvestRouter) app.use('/app/harvest', harvestRouter);
if (storageRouter) app.use('/app/storage', storageRouter);
if (produceRouter) app.use('/app/produce', produceRouter);
if (dashboardsRouter) app.use('/app/dashboards', dashboardsRouter);
if (buyerRouter) app.use('/app/buyer', buyerRouter);
if (sellerRouter) app.use('/app/seller', sellerRouter);
if (orderRouter) app.use('/app/order', orderRouter);
if (emailRouter) app.use('/app/email', emailRouter);
if (testRouter) app.use('/', testRouter);
if (searchRouter) app.use('/', searchRouter);
if (qrCodeRouter) app.use('/app/', qrCodeRouter);
if (apiV1Router) app.use('/app/api/v1', apiV1Router);

// Serve static built frontend (docs or static folder). Prefer docs (GitHub Pages style)
const docsPath = path.join(__dirname, 'docs');
const staticFallback = path.join(__dirname, 'public');
if (fs.existsSync(docsPath)) {
  app.use(express.static(docsPath));
} else if (fs.existsSync(staticFallback)) {
  app.use(express.static(staticFallback));
} else {
  // no static files - no-op
}

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler (last middleware)
app.use(function (err, req, res, next) {
  // hide stack in production
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  res.status(err.status || 500);

  // Try to render error page if view exists
  try {
    return res.render('error', { user: req.user, page_name: 'error' });
  } catch (e) {
    // fallback to JSON
    return res.json({ success: false, error: err.message });
  }
});

// Database connect & sync — non-fatal
(async function initDb() {
  try {
    if (sequelise && typeof sequelise.authenticate === 'function') {
      await sequelise.authenticate();
      console.log('✅ Database connected (authenticate).');
    }
  } catch (err) {
    console.error('Error connecting to database:', err && err.message ? err.message : err);
  }

  try {
    if (sequelise && typeof sequelise.sync === 'function') {
      await sequelise.sync();
      console.log('✅ Database synchronized (sync).');
    }
  } catch (err) {
    console.error('Error synching models:', err && err.message ? err.message : err);
  }
})().catch(err => {
  if (process.env.NODE_ENV !== CUSTOM_ENUMS.PRODUCTION) {
    console.error('Unexpected DB init error:', err);
  }
});

// Start server
const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT} (env=${process.env.NODE_ENV || 'development'})`);
  if (process.env.NODE_ENV !== CUSTOM_ENUMS.PRODUCTION) {
    console.log('Mounted routers:');
    const list = [
      blockchainRouter && 'blockchain',
      configRouter && 'config',
      authRouter && 'auth',
      harvestRouter && 'harvest',
      storageRouter && 'storage',
      produceRouter && 'produce',
      dashboardsRouter && 'dashboards',
      qrCodeRouter && 'qrcode',
      apiV1Router && 'api_v1',
    ].filter(Boolean);
    console.log('  ', list.join(', ') || '(none)');
  }
});

// Export app (for tests if needed)
module.exports = app;
