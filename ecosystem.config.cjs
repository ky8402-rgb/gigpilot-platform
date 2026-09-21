module.exports = {
  apps: [
    {
      name: 'gigpilot',
      script: './dist/server.cjs',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0',
        BINANCE_MARKET_DATA_ENABLED: 'false',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0',
        BINANCE_MARKET_DATA_ENABLED: 'false',
      },
    },
    {
      name: 'worker',
      script: './dist/worker.cjs',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        BINANCE_MARKET_DATA_ENABLED: 'false',
      },
      env_production: {
        NODE_ENV: 'production',
        BINANCE_MARKET_DATA_ENABLED: 'false',
      },
    },
  ],
};
