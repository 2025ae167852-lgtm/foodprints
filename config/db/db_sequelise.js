const { Sequelize } = require('sequelize');

const connectionString = process.env.DATABASE_URL;
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  protocol: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});
sequelize
  .authenticate()
  .then(() => {
    console.log('✅ Database connected successfully (PostgreSQL with SSL)');
  })
  .catch((err) => {
    console.error('❌ Unable to connect to the database:', err);
  });

module.exports = sequelize;
