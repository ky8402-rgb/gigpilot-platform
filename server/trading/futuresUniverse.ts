import { Request, Response } from 'express';

export interface FuturesMarketCandidate {
  exchange: 'BYBIT' | 'BINANCE';
  symbol: string;
  baseAsset: string;
  quoteAsset: 'USDT';
  contractType: 'PERPETUAL';
  status: string;
  price: number;
  volume24h: number;
  change24hPct: number;
  fundingRate: number | null;
  bid: number;
  ask: number;
  spreadBps: number;
  tickSize: number | null;
  qtyStep: number | null;
  makerFeeBps: number | null;
  takerFeeBps: number | null;
  liquidityScore: number;
  executionScore: number;
  eligible: boolean;
  reasons: string[];
}

function n(v: unknown): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

async function json(url: string, timeoutMs = 7000): Promise<any> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

function score(volume24h: number, spreadBps: number, price: number, bid: number, ask: number): number {
  const depthProxy = Math.log10(Math.max(volume24h, 1));
  const spreadPenalty = Math.max(0, spreadBps);
  const quoteIntegrity = bid > 0 && ask >= bid && price > 0 ? 1 : 0;
  return Math.max(0, Math.min(100, depthProxy * 12 + quoteIntegrity * 20 - spreadPenalty * 1.5));
}

export async function discoverFuturesUniverse(): Promise<FuturesMarketCandidate[]> {
  const [bybitInfo, bybitTickers, binanceInfo, binanceTickers, binanceFunding] = await Promise.allSettled([
    json('https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000'),
    json('https://api.bybit.com/v5/market/tickers?category=linear'),
    json('https://fapi.binance.com/fapi/v1/exchangeInfo'),
    json('https://fapi.binance.com/fapi/v1/ticker/24hr'),
    json('https://fapi.binance.com/fapi/v1/premiumIndex')
  ]);

  const out: FuturesMarketCandidate[] = [];
  const bTick = new Map<string, any>((bybitTickers.status === 'fulfilled' ? (bybitTickers.value?.result?.list || []) : []).map((x: any) => [x.symbol, x]));
  if (bybitInfo.status === 'fulfilled') {
    for (const x of bybitInfo.value?.result?.list || []) {
      if (x.contractType !== 'LinearPerpetual' || x.quoteCoin !== 'USDT' || x.status !== 'Trading') continue;
      const t = bTick.get(x.symbol);
      const bid = n(t?.bid1Price) || 0, ask = n(t?.ask1Price) || 0, price = n(t?.lastPrice) || 0;
      const volume = n(t?.turnover24h) || 0;
      const spreadBps = bid > 0 && ask >= bid ? ((ask - bid) / ((ask + bid) / 2)) * 10000 : Infinity;
      const reasons: string[] = [];
      if (!(price > 0 && bid > 0 && ask >= bid)) reasons.push('INVALID_QUOTE');
      if (!Number.isFinite(spreadBps) || spreadBps > 40) reasons.push('WIDE_SPREAD');
      out.push({
        exchange: 'BYBIT', symbol: x.symbol, baseAsset: x.baseCoin, quoteAsset: 'USDT', contractType: 'PERPETUAL',
        status: x.status, price, volume24h: volume, change24hPct: n(t?.price24hPcnt) ? Number(t.price24hPcnt) * 100 : 0,
        fundingRate: n(t?.fundingRate), bid, ask, spreadBps,
        tickSize: n(x?.priceFilter?.tickSize), qtyStep: n(x?.lotSizeFilter?.qtyStep),
        makerFeeBps: null, takerFeeBps: null,
        liquidityScore: score(volume, spreadBps, price, bid, ask),
        executionScore: score(volume, spreadBps, price, bid, ask),
        eligible: reasons.length === 0, reasons
      });
    }
  }

  const binTick = new Map<string, any>((binanceTickers.status === 'fulfilled' ? binanceTickers.value || [] : []).map((x: any) => [x.symbol, x]));
  const binFund = new Map<string, any>((binanceFunding.status === 'fulfilled' ? binanceFunding.value || [] : []).map((x: any) => [x.symbol, x]));
  if (binanceInfo.status === 'fulfilled') {
    for (const x of binanceInfo.value?.symbols || []) {
      if (x.contractType !== 'PERPETUAL' || x.quoteAsset !== 'USDT' || x.status !== 'TRADING') continue;
      const t = binTick.get(x.symbol), fnd = binFund.get(x.symbol);
      const bid = n(t?.bidPrice) || 0, ask = n(t?.askPrice) || 0, price = n(t?.lastPrice) || 0;
      const volume = n(t?.quoteVolume) || 0;
      const spreadBps = bid > 0 && ask >= bid ? ((ask - bid) / ((ask + bid) / 2)) * 10000 : Infinity;
      const reasons: string[] = [];
      if (!(price > 0 && bid > 0 && ask >= bid)) reasons.push('INVALID_QUOTE');
      if (!Number.isFinite(spreadBps) || spreadBps > 40) reasons.push('WIDE_SPREAD');
      out.push({
        exchange: 'BINANCE', symbol: x.symbol, baseAsset: x.baseAsset, quoteAsset: 'USDT', contractType: 'PERPETUAL',
        status: x.status, price, volume24h: volume, change24hPct: n(t?.priceChangePercent) || 0,
        fundingRate: n(fnd?.lastFundingRate), bid, ask, spreadBps,
        tickSize: n(x?.filters?.find((f: any) => f.filterType === 'PRICE_FILTER')?.tickSize),
        qtyStep: n(x?.filters?.find((f: any) => f.filterType === 'LOT_SIZE')?.stepSize),
        makerFeeBps: null, takerFeeBps: null,
        liquidityScore: score(volume, spreadBps, price, bid, ask),
        executionScore: score(volume, spreadBps, price, bid, ask),
        eligible: reasons.length === 0, reasons
      });
    }
  }
  return out.sort((a, b) => (b.executionScore + b.liquidityScore) - (a.executionScore + a.liquidityScore));
}

export async function futuresUniverseHandler(_req: Request, res: Response) {
  try {
    const markets = await discoverFuturesUniverse();
    res.setHeader('Cache-Control', 'private, max-age=3');
    return res.json({ success: true, source: 'LIVE_EXCHANGE_METADATA', generatedAt: new Date().toISOString(), markets });
  } catch (err: any) {
    return res.status(503).json({
      success: false, error: 'MARKET_UNIVERSE_UNAVAILABLE',
      reasons: [{ code: 'LIVE_METADATA_UNAVAILABLE', message: err?.message || 'Live futures metadata unavailable; trading remains fail-closed.' }]
    });
  }
}
