// Metro config for the VialTrack Count app.
//
// The app lives inside the web repo and imports the shared count core from
// `../src/shared` (and the Firebase config JSON from the repo root), so the repo
// root is added as a watch folder. The web app's own node_modules are blocked so
// every package resolves from mobile/node_modules only (one copy of React and of
// the Firebase SDK).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [repoRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

const escape = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
config.resolver.blockList = [
  new RegExp(`^${escape(path.join(repoRoot, 'node_modules'))}/.*`),
  new RegExp(`^${escape(path.join(repoRoot, 'desktop'))}/.*`),
  new RegExp(`^${escape(path.join(repoRoot, 'dist'))}/.*`),
  new RegExp(`^${escape(path.join(repoRoot, '.git'))}/.*`),
];

// The Firebase JS SDK ships its React Native builds through the legacy
// "react-native" package.json field; resolving through "exports" picks the
// browser build and fails with "Component auth has not been registered yet".
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
