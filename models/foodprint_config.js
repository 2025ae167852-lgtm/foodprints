const Sequelize = require('sequelize');
module.exports = function (sequelize, DataTypes) {
  return sequelize.define(
    'FoodprintConfig',
    {
      id: {
        autoIncrement: true,
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      config_key: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      config_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      config_description: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      config_value: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      log_datetime: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: Sequelize.NOW,
      },
    },
    {
      sequelize,
      tableName: 'foodprint_config',
      timestamps: false,
      indexes: [
        {
          name: 'foodprint_config_pk',
          unique: true,
          using: 'BTREE',
          fields: [{ name: 'id' }],
        },
      ],
    }
  );
};
