/**
 * One-time helper: copy local clasp credentials into GitHub Actions secrets.
 *
 * Prerequisites:
 *   1. Enable Apps Script API: https://script.google.com/home/usersettings
 *   2. npx @google/clasp@3.4.0 login
 *   3. backend/.clasp.json with your scriptId (copy from .clasp.json.example)
 *   4. gh auth login  (already done if `gh` works)
 *
 * Usage:
 *   node scripts/setup-appsscript-github.mjs <web-app-deployment-id>
 *
 * The deployment id is the middle segment of the Web app URL:
 *   https://script.google.com/macros/s/THIS_PART/exec
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const clasprcPath = join(homedir(), '.clasprc.json');
const claspJsonPath = join(root, 'backend', '.clasp.json');

const deploymentId = (process.argv[2] || process.env.APPS_SCRIPT_DEPLOYMENT_ID || '').trim();

const missing = [];
if (!existsSync(clasprcPath)) {
  missing.push('~/.clasprc.json  →  run:  npx @google/clasp@3.4.0 login');
}
if (!existsSync(claspJsonPath)) {
  missing.push('backend/.clasp.json  →  copy backend/.clasp.json.example and paste Script ID (Project Settings)');
}
if (!deploymentId) {
  missing.push('deployment id  →  node scripts/setup-appsscript-github.mjs <AKfycb...>');
}

if (missing.length) {
  console.error('Not ready. Fix:\n');
  for (const line of missing) console.error('  -', line);
  console.error('\nAlso enable: https://script.google.com/home/usersettings');
  process.exit(1);
}

function setSecret(name, value) {
  execFileSync('gh', ['secret', 'set', name, '--body', value], { stdio: 'inherit' });
}

setSecret('CLASPRC_JSON', readFileSync(clasprcPath, 'utf8'));
setSecret('CLASP_JSON', readFileSync(claspJsonPath, 'utf8'));
setSecret('APPS_SCRIPT_DEPLOYMENT_ID', deploymentId);
console.log('GitHub secrets set. Next push to backend/ on main will deploy.');
