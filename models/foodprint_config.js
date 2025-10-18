const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'FoodprintConfig',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true,
        field: 'id' // Renamed from 'pk' to a standard primary key
      },
      configid: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        field: 'configid'
      },
      configname: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      configdescription: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      configvalue: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      logdatetime: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: true,
      },
    },
    {
      sequelize,
      tableName: 'foodprint_config',
      timestamps: false,
      indexes: [
        {
          name: 'foodprint_config_configid_key',
          unique: true,
          fields: ['configid'],
        },
        {
          name: 'foodprint_config_pkey',
          unique: true,
          fields: ['id'],
        },
      ],
    }
  );
};
