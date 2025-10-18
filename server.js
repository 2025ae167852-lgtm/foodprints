// ==========================
// ✅ Core Imports
// ==========================
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

// ==========================
// ✅ Initialize Express
// ==========================
const app = express();
const PORT = process.env.PORT || 3000;

// ==========================
// ✅ Middleware
// ==========================
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 🔒 Secure session (MemoryStore is OK for dev but not production)
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'SUPER_SECRET_KEY',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // secure cookies in production
      maxAge: 1000 * 60 * 60 * 2 // 2 hours
    }
  })
);

// ==========================
// ✅ Static Frontend Support
// ==========================
const staticPath = path.join(__dirname, 'foodprint-static');
app.use(express.static(staticPath));

// ==========================
// ✅ API Routes Integration
// ==========================
app.use('/app/auth', require('./routes/auth'));
app.use('/app/blockchain', require('./routes/blockchain'));
app.use('/app/config', require('./routes/config'));
app.use('/app/dashboards', require('./routes/dashboards'));
app.use('/app/harvest', require('./routes/harvest'));
app.use('/app/order', require('./routes/order'));
app.use('/app/produce', require('./routes/produce'));
app.use('/app/buyer', require('./routes/buyer'));
app.use('/app/seller', require('./routes/seller'));
app.use('/app/storage', require('./routes/storage'));
app.use('/app/email', require('./routes/email'));
app.use('/app/api/v1', require('./routes/api_v1'));
app.use('/app/qrcode', require('./routes/qrcode'));
app.use('/app/search', require('./routes/search'));
app.use('/app/test', require('./routes/test'));

// ==========================
// ✅ Default Route
// ==========================
app.get('/', (req, res) => {
  res.sendFile(path.join(staticPath, 'index.html'));
});

// ==========================
// ✅ 404 Handler
// ==========================
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ==========================
// ✅ Global Error Handler
// ==========================
app.use((err, req, res, next) => {
  console.error('🔥 Server Error:', err.message);
  res.status(500).json({ error: 'Internal Server Error' });
});

// ==========================
// ✅ Start Server
// ==========================
app.listen(PORT, () => {
  console.log(`🚀 FoodPrint Server is running on port ${PORT}`);
  console.log(`🌐 Access it at http://localhost:${PORT}`);
});
