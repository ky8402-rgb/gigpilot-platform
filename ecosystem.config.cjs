const path = require('path');
const fs = require('fs');

const projectVenvPython3 = path.resolve(__dirname, '.venv', 'bin', 'python3');
const projectVenvPython = path.resolve(__dirname, '.venv', 'bin', 'python');
const pythonInterpreter = fs.existsSync(projectVenvPython3)
  ? projectVenvPython3
  : (fs.existsSync(projectVenvPython) ? projectVenvPython : projectVenvPython3);

module.exports = {
  apps: [
    {
      name: 'gigpilot',
      script: './dist/server.cjs',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Mirrors `env` so `pm2 start --env production` resolves an environment for every app and
      // pm2 stops logging "Environment [production] is not defined in process file". Purely
      // additive: pm2 merges `env` with the selected `env_<name>` block, so no value changes.
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
    {
      name: 'worker',
      script: './dist/worker.cjs',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        // The worker imports the same store singleton, whose constructor starts reconciliation,
        // capital sync and the autonomous optimizer. Without this flag BOTH pm2 processes would
        // run those loops against the same live Bybit account with separate in-memory state.
        // The API process ('gigpilot') owns them; this process must stay inert.
        GIGPILOT_DISABLE_BACKGROUND_LOOPS: '1',
      },
      // Repeated under env_production as well: the deploy runs `pm2 start ... --env production`,
      // and the worker exits(1) if this flag is absent. Setting it in both places means the
      // worker cannot enter a crash loop over a pm2 env-resolution difference.
      env_production: {
        GIGPILOT_DISABLE_BACKGROUND_LOOPS: '1',
      },
    },
    {
      name: 'gigpilot-engine',
      script: './gigpilot.py',
      // requirements.txt is installed into .venv by scripts/deploy-ec2.sh. Running the
      // system python3 cannot import those deps (aiohttp) and crash-loops the engine.
      interpreter: pythonInterpreter,
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        GIGPILOT_BIND: '127.0.0.1',
        GIGPILOT_PORT: '8001',
        // Fail-closed: the engine must start disarmed.
        GIGPILOT_ARM: '0',
      },
      // Mirrored so `--env production` resolves for this app too. GIGPILOT_ARM is repeated
      // deliberately: if this block ever replaced the base env, the engine must still be
      // disarmed rather than falling back to a permissive default.
      env_production: {
        GIGPILOT_BIND: '127.0.0.1',
        GIGPILOT_PORT: '8001',
        GIGPILOT_ARM: '0',
      },
    },
  ],
};
