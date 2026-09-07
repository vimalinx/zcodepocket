const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { checkMetadata } = require('./check-release-source.cjs');

const EXPO_DEBUG_CERT = 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c';

function normalizeFingerprint(value) {
  const normalized = (value ?? '').trim().replace(/:/g, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error('Set ZCODEPOCKET_RELEASE_CERT_SHA256 to the approved release certificate SHA-256');
  return normalized;
}

function checkCertificate(output, expected) {
  // Android build-tools and the standalone apksigner use different labels.
  const certs = [...output.matchAll(/^(?:Signer #\d+|V\d+(?:\.\d+)* Signer):? certificate SHA-256 digest:\s*([a-f0-9]{64})\s*$/gmi)];
  const unique = new Set(certs.map((match) => match[1].toLowerCase()));
  if (output.match(/^Number of signers:\s*(\d+)\s*$/m)?.[1] !== '1' || unique.size !== 1) {
    throw new Error('Expected exactly one APK signer');
  }
  const [actual] = unique;
  if (/certificate DN:.*\bCN\s*=\s*Android Debug\b/i.test(output) || actual === EXPO_DEBUG_CERT) {
    throw new Error('Default Android/Expo debug signing is not allowed for a public release');
  }
  if (actual !== normalizeFingerprint(expected)) throw new Error('APK certificate does not match the approved release certificate');
  return actual;
}

function checkBadging(output, expo) {
  const packageLine = output.match(/^package: (.*)$/m)?.[1] ?? '';
  const field = (key) => packageLine.match(new RegExp(`(?:^| )${key}='([^']*)'`))?.[1];
  if (field('name') !== expo.android.package) throw new Error('APK package mismatch');
  if (field('versionName') !== expo.version || field('versionCode') !== String(expo.android.versionCode)) {
    throw new Error('APK versionName/versionCode mismatch');
  }
  if (/^application-debuggable(?:\s|$)/m.test(output)) throw new Error('Debuggable APK cannot be released');
  const nativeLine = output.match(/^native-code:\s*(.*)$/m)?.[1] ?? '';
  const abis = [...nativeLine.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  if (abis.length !== 1 || abis[0] !== 'arm64-v8a') throw new Error('Expected an arm64-v8a-only APK');
}

async function main() {
  if (process.argv.length !== 3) throw new Error('Usage: npm run verify:release-apk -- <apk>');
  const expected = normalizeFingerprint(process.env.ZCODEPOCKET_RELEASE_CERT_SHA256);
  const root = path.resolve(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const { expo } = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const errors = checkMetadata(pkg, expo);
  if (errors.length) throw new Error(errors.join('\n'));
  const apk = path.resolve(process.argv[2]);
  const name = `zcodepocket-${expo.version}-${expo.android.versionCode}-arm64-v8a.apk`;
  if (path.basename(apk) !== name) throw new Error(`APK filename must be ${name}`);
  if (!fs.statSync(apk).isFile()) throw new Error('APK must be a regular file');
  const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  const signer = run('apksigner', ['verify', '--verbose', '--print-certs', apk]);
  const certificate = checkCertificate(signer, expected);
  checkBadging(run('aapt', ['dump', 'badging', apk]), expo);
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(apk)) hash.update(chunk);
  console.log(JSON.stringify({ file: name, version: expo.version, versionCode: expo.android.versionCode,
    package: expo.android.package, certificateSha256: certificate, sha256: hash.digest('hex') }, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { normalizeFingerprint, checkCertificate, checkBadging };
