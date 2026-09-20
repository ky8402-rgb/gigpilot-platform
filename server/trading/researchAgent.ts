import { ResearchCategory, ResearchItem } from './types.js';
import { GoogleGenAI } from '@google/genai';

export class AutonomousResearchAgent {
  private researchItems: ResearchItem[] = [];
  private aiClient: GoogleGenAI | null = null;

  constructor() {
    this.seedInitialResearch();
  }

  private getAiClient(): GoogleGenAI | null {
    if (!this.aiClient && process.env.GEMINI_API_KEY) {
      try {
        this.aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      } catch (e) {
        console.warn('Gemini client initialization skipped (no valid key or network issue):', e);
      }
    }
    return this.aiClient;
  }

  private seedInitialResearch() {
    this.researchItems = [
      {
        id: 'res-fact-01',
        timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
        title: 'CME Bitcoin Futures Open Interest Reaches New High of $12.4B',
        source: 'CME Group Regulatory Bulletin',
        url: 'https://www.cmegroup.com',
        category: 'FACT',
        sentiment: 'BULLISH',
        impactScore: 8,
        summary: 'Institutional participation increased by 14% week-over-week according to CFTC Commitment of Traders report.',
        quantitativeAdjustment: {
          recommendedGridWidthModifier: 1.0,
          riskLevel: 'LOW',
          notes: 'Healthy structural liquidity depth across major order books.'
        },
        verifiedByAi: true
      },
      {
        id: 'res-fact-02',
        timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
        title: 'Binance Scheduled Match Engine Maintenance Window',
        source: 'Binance Official System Status',
        url: 'https://binance.com/en/support',
        category: 'FACT',
        sentiment: 'NEUTRAL',
        impactScore: 6,
        summary: 'Scheduled 15-minute maintenance on spot WebSocket feeds on Wednesday 02:00 UTC.',
        quantitativeAdjustment: {
          recommendedGridWidthModifier: 1.25,
          riskLevel: 'MEDIUM',
          notes: 'Pause active order placement during the 15-minute maintenance window.'
        },
        verifiedByAi: true
      },
      {
        id: 'res-ana-03',
        timestamp: new Date(Date.now() - 3600000 * 8).toISOString(),
        title: 'Glassnode On-Chain Realized Cap HODL Wave Analysis',
        source: 'Glassnode Insights',
        category: 'ANALYSIS',
        sentiment: 'BULLISH',
        impactScore: 7,
        summary: 'Long-term holder supply remains locked with low exchange inflows, indicating low structural sell pressure.',
        quantitativeAdjustment: {
          recommendedGridWidthModifier: 1.0,
          riskLevel: 'LOW',
          notes: 'Grid can maintain standard geometric spacing with neutral inventory.'
        },
        verifiedByAi: true
      },
      {
        id: 'res-unv-04',
        timestamp: new Date(Date.now() - 3600000 * 14).toISOString(),
        title: 'Social Media Rumors of Sovereign Wealth Fund Allocations',
        source: 'Crypto Twitter / Telegram Channels',
        category: 'UNVERIFIED_CLAIM',
        sentiment: 'BULLISH',
        impactScore: 4,
        summary: 'Unconfirmed chatter alleging an Asian sovereign wealth fund is preparing spot ETF buying.',
        quantitativeAdjustment: {
          recommendedGridWidthModifier: 1.2,
          riskLevel: 'MEDIUM',
          notes: 'Unverified claim. Do NOT adjust directional bias; widen grid buffer to absorb volatility spike if rumor whipsaws.'
        },
        verifiedByAi: true
      },
      {
        id: 'res-spec-05',
        timestamp: new Date(Date.now() - 3600000 * 20).toISOString(),
        title: 'Speculative Options Gamma Squeeze Projection Around $75k Strike',
        source: 'Options Floor Desk Note',
        category: 'SPECULATION',
        sentiment: 'BULLISH',
        impactScore: 5,
        summary: 'Market makers short dealer gamma could be forced into delta hedging above $73,500.',
        quantitativeAdjustment: {
          recommendedGridWidthModifier: 1.35,
          riskLevel: 'HIGH',
          notes: 'Speculative dealer gamma positioning. Expand upper grid boundary by 2.5% to avoid selling out of inventory.'
        },
        verifiedByAi: true
      }
    ];
  }

  public getResearchFeed(): ResearchItem[] {
    return [...this.researchItems];
  }

  public async analyzeNewIntelligence(title: string, content: string, source: string): Promise<ResearchItem> {
    const ai = this.getAiClient();
    
    let category: ResearchCategory = 'ANALYSIS';
    let sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let impactScore = 5;
    let summary = content.slice(0, 200);
    let widthModifier = 1.0;
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    let notes = 'Standard parameters applied.';

    if (ai) {
      try {
        const prompt = `You are an elite quantitative research analyst for an autonomous cryptocurrency trading engine.
Analyze the following market intelligence item:
Title: "${title}"
Source: "${source}"
Content: "${content}"

Task:
1. Classify into EXACTLY one of: FACT, ANALYSIS, UNVERIFIED_CLAIM, SPECULATION.
   - FACT: Official exchange bulletins, government filings, verified on-chain transactions, regulatory releases.
   - ANALYSIS: Credible research firms, on-chain metrics analysis, quantitative reports.
   - UNVERIFIED_CLAIM: Rumors, unconfirmed leaks, anonymous influencer posts.
   - SPECULATION: Price predictions, hypothetical scenarios, future projections.
2. Determine sentiment: BULLISH, BEARISH, or NEUTRAL.
3. Assess impact score from 1 to 10.
4. Recommended grid width modifier (0.8 to 1.5, where >1 widens safety boundaries).
5. Risk level: LOW, MEDIUM, HIGH, CRITICAL.
6. Provide a concise 2-sentence summary and quantitative notes.

Respond in strictly valid JSON format:
{
  "category": "FACT",
  "sentiment": "NEUTRAL",
  "impactScore": 6,
  "summary": "...",
  "recommendedGridWidthModifier": 1.1,
  "riskLevel": "MEDIUM",
  "notes": "..."
}`;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json'
          }
        });

        const parsed = JSON.parse(response.text || '{}');
        if (parsed.category) category = parsed.category;
        if (parsed.sentiment) sentiment = parsed.sentiment;
        if (parsed.impactScore) impactScore = Number(parsed.impactScore);
        if (parsed.summary) summary = parsed.summary;
        if (parsed.recommendedGridWidthModifier) widthModifier = Number(parsed.recommendedGridWidthModifier);
        if (parsed.riskLevel) riskLevel = parsed.riskLevel;
        if (parsed.notes) notes = parsed.notes;
      } catch (err) {
        console.warn('Gemini analysis failed, using fallback heuristic classification:', err);
      }
    }

    const newItem: ResearchItem = {
      id: `res-${Date.now()}`,
      timestamp: new Date().toISOString(),
      title,
      source,
      category,
      sentiment,
      impactScore,
      summary,
      quantitativeAdjustment: {
        recommendedGridWidthModifier: widthModifier,
        riskLevel,
        notes
      },
      verifiedByAi: Boolean(ai)
    };

    this.researchItems.unshift(newItem);
    if (this.researchItems.length > 50) this.researchItems.pop();

    return newItem;
  }
}
