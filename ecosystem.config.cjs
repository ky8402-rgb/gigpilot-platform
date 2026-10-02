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
      },
    },
    {
      name: 'gigpilot-engine',
      script: './gigpilot.py',
      interpreter: 'python3',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        GIGPILOT_BIND: '127.0.0.1',
        GIGPILOT_PORT: '8001',
        GIGPILOT_ARM: '0',
      },
    },
  ],
};
