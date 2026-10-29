// Never silently fall back to the toolkit's shared debug key.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function check(root, release) {
  const folder = path.join(root, 'band9/sign', release ? 'release' : 'debug');
  const keyPath = path.join(folder, 'private.pem');
  const certPath = path.join(folder, 'certificate.pem');
  for (const file of [keyPath, certPath, path.join(root, 'signing/band9/development.p12')]) {
    if (!fs.existsSync(file)) throw new Error('Band 9 signing identity missing. Run tools/prepare-band9-signing.ps1 locally; do not use upstream/default keys.');
  }
  const key = crypto.createPrivateKey(fs.readFileSync(keyPath));
  const cert = new crypto.X509Certificate(fs.readFileSync(certPath));
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) throw new Error('Expected RSA >= 2048.');
  const exported = crypto.createPublicKey(key).export({ format: 'der', type: 'spki' });
  if (!exported.equals(cert.publicKey.export({ format: 'der', type: 'spki' }))) throw new Error('Certificate/private key mismatch. Do not rotate an installed identity.');
  return cert.fingerprint256;
}
if (require.main === module) {
  try { console.log('Band 9 PEM key pair checked: ' + check(path.resolve(__dirname, '..'), process.argv.includes('--release'))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { check };
