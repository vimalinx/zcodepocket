const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const required = [
  'README.md', 'LICENSE', 'CONTRIBUTING.md', 'SECURITY.md', 'THIRD_PARTY.md',
  'RELEASING.md', 'docs/release-readiness.md', 'bun.lock', '.github/workflows/ci.yml',
];

function checkMetadata(pkg, expo) {
  const errors = [];
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version ?? '')) {
    errors.push('package.json must use a stable X.Y.Z version');
  }
  if (pkg.version !== expo.version) errors.push('package.json and app.json versions differ');
  if (!Number.isInteger(expo.android?.versionCode) || expo.android.versionCode < 1) {
    errors.push('android.versionCode must be a positive integer');
  }
  if (expo.android?.package !== 'com.vimalinx.zcpocket') errors.push('unexpected Android package');
  if (pkg.name !== 'zcodepocket' || pkg.license !== 'MIT') errors.push('unexpected package identity or license');
  if (pkg.repository?.url !== 'https://github.com/vimalinx/zcodepocket.git') {
    errors.push('unexpected source repository');
  }
  return errors;
}

function forbiddenPath(file) {
  return /(^|\/)(node_modules|android|ios|builds|dist|web-build|\.expo|\.runtime|\.video_agent|\.git)(\/|$)/.test(file)
    || /\.(apk|aab|jks|keystore|p8|p12|key|pem|mobileprovision|log|db|sqlite\d*|backup)([-.]|$)/i.test(file)
    || /(^|\/)\.env(?:\..*)?$/.test(file) && path.posix.basename(file) !== '.env.example'
    || /(^|\/)local\.properties$/.test(file);
}

function main() {
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim();
  if (fs.realpathSync(repoRoot) !== fs.realpathSync(root)) throw new Error('Run inside the standalone ZCode Pocket repository');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const { expo } = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  // Include tracked ignored files and new non-ignored files, not private local build directories.
  const names = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  }).split('\0').filter(Boolean))];
  const errors = checkMetadata(pkg, expo);
  const existing = new Set();
  for (const file of names) {
    let stat;
    try { stat = fs.lstatSync(path.join(root, file)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    existing.add(file);
    if (!stat.isFile()) errors.push(`non-regular candidate file: ${file}`);
    if (forbiddenPath(file)) errors.push(`excluded artifact or private-state path: ${file}`);
  }
  for (const file of required) {
    if (!existing.has(file)) errors.push(`missing release documentation/config: ${file}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Source candidate checks passed: ${existing.size} files; ${pkg.version} (${expo.android.versionCode}).`);
  console.log('Scope/metadata only. Secret, dependency, license, APK and device checks are separate.');
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { checkMetadata, forbiddenPath };
