#!/usr/bin/env node
/**
 * Assembles the publishable static site for the web deployment.
 *
 * Render serves this directory as a CDN static site:
 *
 *   index.html          the marketing landing page   -> GET /
 *   styles.css          the landing page stylesheet  -> GET /styles.css
 *   app.html            the Expo web SPA shell       -> rewritten to for every
 *                                                      other path, so expo-router
 *                                                      hydrates and handles the
 *                                                      route itself
 *   _expo/…  assets/…   Expo bundles and static assets (referenced from app.html
 *                       as root-absolute paths such as /_expo/static/js/web/…,
 *                       so they must stay at the site root)
 *
 * Two rules make the "/" landing page possible at all:
 *
 *  1. The Expo shell MUST NOT be called index.html. Render serves a rewrite's
 *     destination as a real file, so if the catch-all `/* -> /index.html` stayed
 *     as-is, every unknown path (/nope) would be answered with the landing page
 *     instead of the app. Renaming it to app.html removes the collision.
 *
 *  2. The per-route HTML files that `expo export` emits for `web.output: "static"`
 *     (tv.html, tv/[roomCode].html, (tabs)/index.html, …) are deleted. Routing is
 *     handled client-side, so they are dead weight and their directories would
 *     otherwise ship to the CDN.
 *
 * app/ has no index route, so the export's root index.html is an empty-root SPA
 * shell -- byte-for-byte the document that is already deployed today.
 *
 * Usage: node scripts/build-web.js [--skip-export]
 *
 *   --skip-export  reuse the existing mobile_app/dist from a previous run. Only
 *                  use this when iterating on the assembly step -- Metro takes
 *                  ~12 minutes to bundle, and a stale dist will be published as
 *                  if it were fresh.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SKIP_EXPORT = process.argv.includes('--skip-export');

const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');
const LANDING_DIR = path.join(REPO_ROOT, 'landing_page');
const EXPORT_DIR = path.join(APP_ROOT, 'dist');
const OUT_DIR = path.join(APP_ROOT, 'web-build');
const SHELL_NAME = 'app.html';

function fail(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

function runExport() {
  if (SKIP_EXPORT) {
    console.log('▶ --skip-export: reusing ' + path.relative(REPO_ROOT, EXPORT_DIR));
    return;
  }
  console.log('▶ expo export --platform web …');
  const result = spawnSync(
    'npx',
    ['expo', 'export', '--platform', 'web', '--output-dir', EXPORT_DIR],
    { cwd: APP_ROOT, stdio: 'inherit', shell: process.platform === 'win32' }
  );

  if (result.error) fail(`Could not run "npx expo export": ${result.error.message}`);
  if (result.status !== 0) fail(`"expo export" exited with code ${result.status}.`);
}

/** Depth-first list of every file under `dir`, relative to `dir`. */
function listFiles(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else found.push(path.relative(dir, absolute));
    }
  };
  walk(dir);
  return found;
}

/**
 * Removes directories left empty by the deletions in `removed`, deepest first.
 * Candidates come from the removed paths, not from what is left on disk -- a
 * directory that has just been emptied has no remaining files to derive it from.
 */
function pruneEmptyDirs(dir, removed) {
  const dirs = new Set();
  for (const relative of removed) {
    let current = path.dirname(path.join(dir, relative));
    while (current !== dir && current.startsWith(dir)) {
      dirs.add(current);
      current = path.dirname(current);
    }
  }

  for (const candidate of [...dirs].sort((a, b) => b.length - a.length)) {
    try {
      if (fs.readdirSync(candidate).length === 0) fs.rmdirSync(candidate);
    } catch {
      // Already gone, or not a directory. Nothing to prune.
    }
  }
}

function copyExport() {
  if (!fs.existsSync(path.join(EXPORT_DIR, 'index.html'))) {
    fail(`expo export produced no index.html in ${EXPORT_DIR}.`);
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.cpSync(EXPORT_DIR, OUT_DIR, { recursive: true });
  console.log(`▶ copied export → ${path.relative(REPO_ROOT, OUT_DIR)}`);
}

function renameShell() {
  const shell = path.join(OUT_DIR, SHELL_NAME);
  fs.renameSync(path.join(OUT_DIR, 'index.html'), shell);

  const html = fs.readFileSync(shell, 'utf8');
  if (!html.includes('/_expo/static/js/web/')) {
    fail(
      `${SHELL_NAME} has no /_expo/static/js/web/ script tags. The export layout ` +
        'changed — assets are no longer root-absolute, so the shell will not boot ' +
        'from a rewritten path. Re-check scripts/build-web.js before deploying.'
    );
  }
  console.log(`▶ renamed export index.html → ${SHELL_NAME}`);
}

function dropPerRouteHtml() {
  const stale = listFiles(OUT_DIR).filter(
    (relative) => relative.endsWith('.html') && relative !== SHELL_NAME
  );

  for (const relative of stale) fs.rmSync(path.join(OUT_DIR, relative));
  pruneEmptyDirs(OUT_DIR, stale);

  console.log(
    stale.length > 0
      ? `▶ removed ${stale.length} per-route HTML file(s): ${stale.join(', ')}`
      : '▶ no per-route HTML files to remove'
  );
}

function copyLanding() {
  if (!fs.existsSync(path.join(LANDING_DIR, 'index.html'))) {
    fail(`landing_page/index.html not found at ${LANDING_DIR}.`);
  }

  const copied = [];
  for (const entry of fs.readdirSync(LANDING_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name === SHELL_NAME) {
      fail(
        `landing_page/${SHELL_NAME} collides with the Expo SPA shell. ` +
          'Rename the shell or the landing page file.'
      );
    }
    fs.copyFileSync(
      path.join(LANDING_DIR, entry.name),
      path.join(OUT_DIR, entry.name)
    );
    copied.push(entry.name);
  }

  console.log(`▶ landing page → / (${copied.join(', ')})`);
}

function verify() {
  const problems = [];

  // The only two HTML files that should exist are the landing page and the shell.
  const expectedHtml = ['index.html', SHELL_NAME];

  for (const relative of expectedHtml) {
    if (!fs.existsSync(path.join(OUT_DIR, relative))) problems.push(`${relative} missing`);
  }
  if (!fs.existsSync(path.join(OUT_DIR, 'styles.css'))) problems.push('styles.css missing');

  const indexHtml = fs.readFileSync(path.join(OUT_DIR, 'index.html'), 'utf8');
  if (indexHtml.includes('/_expo/static/js/web/')) {
    problems.push('index.html looks like the Expo shell, not the landing page');
  }
  if (!/<link[^>]+href="styles\.css"/.test(indexHtml)) {
    problems.push('landing page does not reference styles.css relatively');
  }

  const strays = listFiles(OUT_DIR).filter(
    (relative) => relative.endsWith('.html') && !expectedHtml.includes(relative)
  );
  if (strays.length > 0) problems.push(`stray HTML: ${strays.join(', ')}`);

  if (problems.length > 0) fail(`Verification failed — ${problems.join('; ')}`);

  const files = listFiles(OUT_DIR);
  const bytes = files.reduce(
    (total, relative) => total + fs.statSync(path.join(OUT_DIR, relative)).size,
    0
  );
  console.log(
    `\n✅ ${path.relative(REPO_ROOT, OUT_DIR)} ready — ` +
      `${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB\n`
  );
}

runExport();
copyExport();
renameShell();
dropPerRouteHtml();
copyLanding();
verify();