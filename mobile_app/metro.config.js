const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.maxWorkers = 2;
config.cacheStores = [];

module.exports = config;
