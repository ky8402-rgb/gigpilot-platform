import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Candle, Fill, Order, OrderBook, OrderBookLevel } from './types.js';

export interface BinanceBalanceItem {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceTransaction {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE' | 'FEE';
  asset: string;
  amount: number;
  valueUsd: number;
  status: string;
  timestamp: string;
  orderId?: string;
  tradeId?: string;
  txId?: string;
  symbol?: string;
  side?: 'BUY' | 'SELL';
  feeUsd?: number;
}

export interface BinanceAssetWithUsd {
  asset: string;
  free: number;
  locked: number;
  total: number;
  usdPrice: number;
  usdValue: number;
  allocationPct: number;
  change24hPct?: number;
}

export interface BinanceAccountState {
  status: 'CONNECTED' | 'RESTRICTED' | 'DISCONNECTED' | 'ERROR';
  message: string;
  serverIp: string;
  timestamp: string;
  totalEquityUsd: number;
  availableCashUsd: number;
  lockedInOrdersUsd: number;
  withdrawableProfitUsd: number;
  initialTradingCapitalUsd: number;
  profitReserveBufferUsd: number;
  spotBalances: BinanceAssetWithUsd[];
  realizedProfitUsd: number;
  unrealizedProfitUsd: number;
  todayPnLUsd: number;
  todayPnLPct: number;
  openOrdersCount: number;
  openOrders: Order[];
  recentTrades: Fill[];
  transactions: BinanceTransaction[];
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  accountType: string;
  apiKeyConfigured: boolean;
  keyMask: string;
}

export class BinanceAdapter {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string = 'https://api.binance.com';
  private serverIp: string = process.env.BINANCE_SERVER_IP || process.env.PUBLIC_IP || '3.222.149.9';
  private priceCache: Map<string, { price: number; time: number }> = new Map();
  private lastAccountState: BinanceAccountState | null = null;
  private lastAccountFetchTime = 0;
  private readonly credentialsPath = path.join(process.cwd(), '.binance-credentials.enc.json');

  constructor() {
    this.apiKey = process.env.BINANCE_API_KEY || '';
    this.apiSecret = process.env.BINANCE_API_SECRET || '';
    if (process.env.BINANCE_API_BASE_URL) this.baseUrl = process.env.BINANCE_API_BASE_URL;

    // Prefer AWS/EC2-injected environment credentials. If the UI was used to
    // configure keys, restore the encrypted-at-rest copy so a PM2 restart does
    // not silently disconnect the Spot account.
    if (!this.apiKey || !this.apiSecret) this.loadEncryptedCredentials();
