import { EngineErrorRecord, EngineHealth, EngineModule, ResearchCategory, ResearchItem } from './types.js';
import { GoogleGenAI } from '@google/genai';

export class AutonomousResearchAgent implements EngineModule {
  public readonly id = 'AI_RESEARCH_AGENT';
  public readonly name = 'AI Research Agent (Gemini Market Intelligence & Macro Risk)';

  private enabled: boolean = true; // Off-switch
  private status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'OFF' = 'HEALTHY';
  private latencyMs: number = 0;
  private lastHeartbeat: string = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];

  private researchItems: ResearchItem[] = [];
  private aiClient: GoogleGenAI | null = null;
  private lastSuccessfulResearchAt: number | null = null;
  private readonly researchFreshnessMs = 30 * 60 * 1000;
  private readonly requestTimeoutMs = 15_000;

  constructor() {
    // Research starts empty. No seeded/stale market claims are treated as live evidence.
  }

  public healthCheck(): EngineHealth {
    const hasKey = Boolean(process.env.GEMINI_API_KEY?.trim());
    const fresh = this.lastSuccessfulResearchAt !== null &&
      (Date.now() - this.lastSuccessfulResearchAt) <= this.researchFreshnessMs;
    const operational = hasKey && fresh && this.status === 'HEALTHY';

    return {
      id: this.id,
      name: this.name,
      status: !this.enabled ? 'OFF' : (operational ? 'HEALTHY' : 'DEGRADED'),
      enabled: this.enabled,
      latencyMs: this.latencyMs,
      lastHeartbeat: this.lastHeartbeat,
      errorCount: this.errorSurface.length,
      lastError: this.errorSurface[0]?.message,
      errorSurface: [...this.errorSurface.slice(0, 10)],
      details: {
        geminiConfigured: hasKey,
        researchItemsCount: this.researchItems.length,
        lastSuccessfulResearchAt: this.lastSuccessfulResearchAt ? new Date(this.lastSuccessfulResearchAt).toISOString() : null,
        freshnessWindowMinutes: this.researchFreshnessMs / 60000,
        researchFresh: fresh,
        model: 'gemini-2.5-flash',
        policy: 'LIVE_RESEARCH_ONLY: no seeded/stale claims are exposed as current evidence; Gemini failures fail closed and never alter core risk controls.'
      }
    };
  }

  public getErrorSurface(): EngineErrorRecord[] {
    return [...this.errorSurface];
  }

  public getOffSwitch(): boolean {
    return this.enabled;
  }

  public setOffSwitch(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.status = 'OFF';
      this.recordError('WARN', 'AI Research Agent switched OFF by operator.');
    } else {
      this.status = 'DEGRADED';
      this.recordError('WARN', 'AI Research Agent switched ON; waiting for a successful fresh Gemini research cycle.');
    }
  }

  public clearErrors(): void {
    this.errorSurface = [];
  }

  private recordError(level: EngineErrorRecord['level'], message: string, details?: any) {
    const rec: EngineErrorRecord = {
      id: `err_research_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      details
    };
    this.errorSurface.unshift(rec);
    if (this.errorSurface.length > 50) this.errorSurface.pop();
  }

  private getAiClient(): GoogleGenAI | null {
    if (!this.aiClient && process.env.GEMINI_API_KEY) {
      try {
        this.aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      } catch (e: any) {
        this.recordError('WARN', `Gemini client initialization failed: ${e.message}`);
      }
    }
    return this.aiClient;
  }

  public getResearchItems(): ResearchItem[] {
    return [...this.researchItems];
  }

  public async evaluateLiveMarketIntelligence(symbol: string, currentPrice: number, change24h: number): Promise<{ success: boolean; item?: ResearchItem; error?: string }> {
    if (!this.enabled) {
      return { success: false, error: 'AI_RESEARCH_AGENT_OFF: Agent disabled by operator' };
    }

    const start = Date.now();
    if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(change24h)) {
      this.status = 'DEGRADED';
      const msg = 'Invalid live market inputs; research request rejected fail-closed.';
      this.recordError('WARN', msg, { symbol, currentPrice, change24h });
      return { success: false, error: msg };
    }

    const ai = this.getAiClient();

    if (!ai) {
      this.status = 'DEGRADED';
      const msg = 'GEMINI_API_KEY environment variable not configured. AI research paused (failing closed).';
      this.recordError('WARN', msg);
      return { success: false, error: msg };
    }

    try {
      const prompt = `You are the GigPilot AI Research Agent operating on real live cryptocurrency market data.
Current live market facts:
- Asset: ${symbol}
- Current Spot Price: $${currentPrice}
- 24h Price Change: ${change24h}%
- Timestamp: ${new Date().toISOString()}

Analyze immediate macro market structure and order flow volatility. Return a concise JSON object with:
{
  "title": "Clear factual headline",
  "category": "FACT" or "ANALYSIS",
  "sentiment": "BULLISH", "BEARISH", or "NEUTRAL",
  "impactScore": number 1 to 10,
  "summary": "1-2 sentence factual synthesis",
  "riskLevel": "LOW", "MEDIUM", or "HIGH",
  "recommendedGridWidthModifier": number (e.g. 0.9 to 1.3),
  "notes": "Quant guidance for grid rebalancing"
}
Output valid JSON only.`;

      const response = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error('Gemini research request timed out.'), { code: 'ETIMEDOUT' })), this.requestTimeoutMs)
        )
      ]);

      const text = response.text?.trim() || '{}';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('AI returned non-JSON response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const validCategory = parsed.category === 'FACT' || parsed.category === 'ANALYSIS';
      const validSentiment = parsed.sentiment === 'BULLISH' || parsed.sentiment === 'BEARISH' || parsed.sentiment === 'NEUTRAL';
      const validRisk = parsed.riskLevel === 'LOW' || parsed.riskLevel === 'MEDIUM' || parsed.riskLevel === 'HIGH' || parsed.riskLevel === 'CRITICAL';
      const validImpact = Number.isFinite(parsed.impactScore) && parsed.impactScore >= 1 && parsed.impactScore <= 10;
      const validModifier = Number.isFinite(parsed.recommendedGridWidthModifier) &&
        parsed.recommendedGridWidthModifier >= 0.9 && parsed.recommendedGridWidthModifier <= 1.3;
      if (!parsed.title || !parsed.summary || !parsed.notes || !validCategory || !validSentiment || !validRisk || !validImpact || !validModifier) {
        throw new Error('Gemini research response failed the strict evidence schema; no research item was accepted.');
      }

      const item: ResearchItem = {
        id: `res_ai_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: String(parsed.title),
        source: 'Gemini 2.5 Market Intelligence',
        category: parsed.category,
        sentiment: parsed.sentiment,
        impactScore: Number(parsed.impactScore),
        summary: String(parsed.summary),
        quantitativeAdjustment: {
          recommendedGridWidthModifier: Number(parsed.recommendedGridWidthModifier),
          riskLevel: parsed.riskLevel,
          notes: String(parsed.notes)
        },
        verifiedByAi: true
      };

      this.researchItems.unshift(item);
      if (this.researchItems.length > 30) this.researchItems.pop();

      this.latencyMs = Date.now() - start;
      this.lastSuccessfulResearchAt = Date.now();
      this.lastHeartbeat = new Date().toISOString();
      this.status = 'HEALTHY';

      return { success: true, item };
    } catch (err: any) {
      this.status = 'DEGRADED';
      const code = Number(err?.status || err?.statusCode) === 429 ? 'RATE_LIMITED'
        : err?.code === 'ETIMEDOUT' ? 'TIMEOUT'
        : 'API_ERROR';
      const msg = `Gemini research ${code.toLowerCase().replace('_', ' ')}; research remains fail-closed.`;
      this.recordError('ERROR', msg, { providerStatus: err?.status || err?.statusCode || null, providerMessage: err?.message || String(err) });
      return { success: false, error: msg };
    }
  }
}
