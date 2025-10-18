// server.js (Minimal Production Version)

require('dotenv').config(); // Load .env first
const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;

// ✅ Database (Sequelize)
const { sequelize } = require('./models'); // Make sure models/index.js exports sequelize

// ✅ Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ View Engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// ✅ Static Files
app.use(express.static(path.join(__dirname, 'public')));

// 🔒 Disable Non-Essential Services
// (Email, blockchain, file uploads, cron jobs, etc. removed for minimal server)

// ✅ Load All Routes from /routes Folder Automatically
const routesPath = path.join(__dirname, 'routes');
if (fs.existsSync(routesPath)) {
  fs.readdirSync(routesPath).forEach((file) => {
    if (file.endsWith('.js')) {
      const route = require(path.join(routesPath, file));
      // Use each route with its own prefix (defined inside file)
      app.use(route);
      console.log(`Route loaded: ${file}`);
    }
  });
} else {
  console.warn('⚠️ Routes folder not found.');
}

// ✅ Default Home Route
app.get('/', (req, res) => {
  res.render('index', { title: 'FoodPrint API Running' });
});

// ✅ Sync Database and Start Server
sequelize.authenticate()
  .then(() => {
    console.log('✅ Database connected successfully.');

    app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
    });
  })
  .catch((err) => {
    console.error('❌ Unable to connect to the database:', err);
  });

module.exports = app;
