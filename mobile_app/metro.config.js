const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Windows file-handle limit workaround: Metro opens too many files in
// parallel and hits EMFILE ("too many open files"). Capping workers keeps
// bundling stable on Windows dev machines.
config.maxWorkers = 2;

module.exports = config;
