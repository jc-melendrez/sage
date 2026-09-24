const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite's web backend loads wa-sqlite as a .wasm asset; without this,
// Metro can't resolve it and every web bundle fails ("Unable to resolve
// module ./wa-sqlite/wa-sqlite.wasm") — which breaks /tv and all web screens.
const defaultAssetExts = config.resolver.assetExts ?? [];
if (!defaultAssetExts.includes('wasm')) {
  config.resolver.assetExts = [...defaultAssetExts, 'wasm'];
}

// Windows file-handle limit workaround: Metro opens too many files in
// parallel and hits EMFILE ("too many open files"). Capping workers keeps
// bundling stable on Windows dev machines.
config.maxWorkers = 2;
config.cacheStores = [];

module.exports = config;
