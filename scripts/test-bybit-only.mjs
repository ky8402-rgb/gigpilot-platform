import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [
  'server/trading/futuresUniverse.ts',
  'src/services/tradingService.ts',
  'src/components/trading/FuturesCommandCenter.tsx'
];

const forbidden = /BINANCE|Binance|binance\.com|fapi\.binance\.com/;
for (const relative of files) {
  const content = fs.readFileSync(path.join(root, relative), 'utf8');
  if (forbidden.test(content)) {
    throw new Error(`Non-Bybit exchange support detected in ${relative}`);
  }
}

const universe = fs.readFileSync(path.join(root, 'server/trading/futuresUniverse.ts'), 'utf8');
if (!universe.includes("exchange: 'BYBIT'")) {
  throw new Error('Futures universe is not explicitly Bybit-only.');
}

console.log('Bybit-only exchange regression guard passed.');
