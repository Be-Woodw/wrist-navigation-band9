// Run after a real build. These are project budgets, NOT claimed firmware limits.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Zip = require('../band9/node_modules/adm-zip');
const file = process.argv[2];
assert.ok(file, 'Usage: node tools/check-band9-package.cjs <band9.rpk>');
const bytes = fs.readFileSync(file);
assert.ok(bytes.length < 1024 * 1024, 'Lightweight target exceeded the 1 MiB project budget.');
const archive = new Zip(bytes);
const names = archive.getEntries().map(entry => entry.entryName);
assert.ok(!names.some(name => /\.(ttf|otf|woff2?)$/i.test(name)), 'External fonts must not be bundled.');
for (const entry of archive.getEntries()) if (!entry.isDirectory) entry.getData();
const manifest = JSON.parse(archive.readAsText('manifest.json'));
assert.equal(manifest.package, 'com.bewoodw.band9.navigation');
assert.equal(manifest.config.designWidth, 192);
assert.ok(manifest.features.some(feature => feature.name === 'system.vibrator'));
assert.ok(!manifest.features.some(feature => feature.name === 'system.storage'));
console.log('Band 9 package identity, dimensions, font exclusion and size budget passed. Verify its signature separately.');
