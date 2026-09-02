// healthcheck.js
import http from 'http';

const port = Number(process.env.PORT) || 3000;

const options = {
  hostname: '127.0.0.1',
  port: port,
  path: '/api/health',
  timeout: 3000
};

const req = http.request(options, (res) => {
  if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
    process.exit(0);
  } else {
    console.error(`Healthcheck failed with status code ${res.statusCode}`);
    process.exit(1);
  }
});

req.on('error', (err) => {
  console.error('Healthcheck network error:', err.message);
  process.exit(1);
});

req.on('timeout', () => {
  console.error('Healthcheck timed out after 3000ms');
  req.destroy();
  process.exit(1);
});

req.end();
