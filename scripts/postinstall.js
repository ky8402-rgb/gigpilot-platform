#!/usr/bin/env node
/**
 * Postinstall lifecycle script
<<<<<<< HEAD
 * Prunes extraneous packages and rebuilds native modules without recursive loops.
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const lockFile = path.resolve('node_modules/.postinstall-lock');

// Prevent circular execution when npm rebuild triggers root postinstall
if (fs.existsSync(lockFile) || process.env.IN_POSTINSTALL_REBUILD === '1') {
  process.exit(0);
}

try {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, String(Date.now()));

  console.log('📦 [postinstall] Pruning extraneous dependencies...');
  try {
    execSync('npm prune', { stdio: 'inherit' });
  } catch (pruneErr) {
    console.warn('⚠️ [postinstall] Prune notice:', pruneErr.message);
  }

  console.log('🔨 [postinstall] Rebuilding native dependencies with npm rebuild...');
  execSync('npm rebuild', {
    stdio: 'inherit',
    env: {
      ...process.env,
      IN_POSTINSTALL_REBUILD: '1'
    }
  });

  console.log('✅ [postinstall] Native dependencies rebuilt successfully.');
} catch (error) {
  console.warn('⚠️ [postinstall] Notice during rebuild:', error.message);
} finally {
  try {
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
  } catch (_) {}
}
=======
 * Fast no-op to prevent blocking dev server startup
 */
console.log('⚡ [postinstall] Dependencies ready.');
process.exit(0);
>>>>>>> 8fab0ab (Deploy to AWS EC2 and AWS Amplify)
