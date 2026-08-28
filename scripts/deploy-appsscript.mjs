/**
 * After `clasp push`, update the existing Web app deployment so the same
 * /exec URL serves the new code. clasp 3: create-deployment -i <id>
 * creates a version and points that deployment at it.
 *
 * Usage: node scripts/deploy-appsscript.mjs [deployment-id]
 * Env:   APPS_SCRIPT_DEPLOYMENT_ID, GITHUB_SHA
 */
import { execFileSync } from 'node:child_process';

const deploymentId = (process.argv[2] || process.env.APPS_SCRIPT_DEPLOYMENT_ID || '').trim();
if (!deploymentId) {
  console.error('Missing APPS_SCRIPT_DEPLOYMENT_ID (GitHub secret or first argument).');
  process.exit(1);
}

const sha = (process.env.GITHUB_SHA || 'manual').slice(0, 7);
const desc = 'ci-' + sha;

execFileSync(
  'clasp',
  ['create-deployment', '--deploymentId', deploymentId, '--description', desc],
  { stdio: 'inherit' }
);
console.log('Redeployed', deploymentId, '→', desc);
