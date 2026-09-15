/**
 * SENTIENT FREELANCER — Memory & Persistence Layer
 * Dual-tier storage: In-Memory cache + Redis (EC2) + Periodic S3 Snapshot (15 min)
 * Public API: load, getState, learn, mutateGenome, enqueueProposal, listProposals,
 *             updateProposal, removeProposal, recordSignature, recentSignatures,
 *             snapshot, resetGenome, health
 */

import Redis from 'ioredis';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const MEMORY_REDIS_KEY = 'sentient:memory';
const QUEUE_REDIS_KEY = 'sentient:queue';
const SIGNATURE_REDIS_KEY = 'sentient:signatures';
const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export const DEFAULT_GENOME = {
  sensitivity: 0.55,    // [0.25–0.92] threshold to bid
  aggressiveness: 0.50, // [0.15–0.95] daily cap weight
  caution: 0.50,        // [0.15–0.90] edit rounds & safety margin
  horizon: 18,          // [8–40] hours to reply forecast
  polishGain: 1.00,     // [0.55–1.90] proposal length scale
  trustDecay: 0.90      // [0.75–0.98] discount rate
};

class MemoryManager {
  constructor() {
    this.redisClient = null;
    this.s3Client = null;
    this.s3Bucket = process.env.S3_BUCKET_NAME || 'sentient-artifacts-default';
    this.redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

    // Local fallback state (persists in memory across requests)
    this.state = {
      episodes: [],
      intuition: {},
      fitnessHist: [],
      signatureLog: [],
      proposalsToday: 0,
      lastCounterDate: new Date().toISOString().slice(0, 10),
      genome: { ...DEFAULT_GENOME },
      genomeBase: { ...DEFAULT_GENOME },
      lastSnapshotAt: Date.now(),
      generation: 1
    };

    // In-memory queue fallback
    this.localQueue = [];

    this.initClients();
    this.startPeriodicSnapshot();
  }

  initClients() {
    // 1. Initialize Redis with graceful fallback
    try {
      this.redisClient = new Redis(this.redisUrl, {
        retryStrategy: (times) => {
          if (times > 5) return null;
          return Math.min(times * 1000, 3000);
        },
        maxRetriesPerRequest: 1,
        connectTimeout: 2000
      });

      this.redisClient.on('error', (err) => {
        console.warn(`[Sentient Memory] Redis connection note: ${err.message}. Running with memory fallback.`);
      });

      this.redisClient.on('connect', () => {
        console.log('[Sentient Memory] Connected to Redis successfully.');
        this.loadFromRedis();
      });
    } catch (e) {
      console.warn(`[Sentient Memory] Redis client init skipped: ${e.message}.`);
    }

    // 2. Initialize S3 client
    try {
      const region = process.env.AWS_REGION || 'us-east-1';
      this.s3Client = new S3Client({ region });
    } catch (e) {
      console.warn(`[Sentient Memory] S3 Client init skipped: ${e.message}`);
    }
  }

  checkDailyRollover() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.state.lastCounterDate !== today) {
      this.state.proposalsToday = 0;
      this.state.lastCounterDate = today;
      this.saveToRedis();
    }
  }

  async loadFromRedis() {
    if (!this.redisClient) return;
    try {
      const raw = await this.redisClient.get(MEMORY_REDIS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.state = {
          ...this.state,
          ...parsed,
          genome: parsed.genome || { ...DEFAULT_GENOME },
          genomeBase: parsed.genomeBase || { ...DEFAULT_GENOME }
        };
        console.log(`[Sentient Memory] Loaded ${this.state.episodes.length} episodes and ${Object.keys(this.state.intuition).length} intuition pairs from Redis.`);
      } else {
        await this.restoreFromS3();
      }
    } catch (err) {
      console.warn(`[Sentient Memory] Error loading state from Redis: ${err.message}`);
    }
  }

  async saveToRedis() {
    if (!this.redisClient) return;
    try {
      await this.redisClient.set(MEMORY_REDIS_KEY, JSON.stringify(this.state));
    } catch (err) {
      console.warn(`[Sentient Memory] Failed to write memory to Redis: ${err.message}`);
    }
  }

  async restoreFromS3() {
    if (!this.s3Client || !process.env.S3_BUCKET_NAME) return;
    try {
      console.log(`[Sentient Memory] Checking for snapshot in S3 bucket: ${this.s3Bucket}`);
      const res = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.s3Bucket,
        Key: 'snapshots/memory-latest.json'
      }));
      const body = await res.Body.transformToString();
      const parsed = JSON.parse(body);
      this.state = { ...this.state, ...parsed };
      console.log('[Sentient Memory] Restored memory from S3 snapshot.');
      await this.saveToRedis();
    } catch (err) {
      console.log(`[Sentient Memory] No prior S3 snapshot found: ${err.message}`);
    }
  }

  async snapshotToS3() {
    if (!this.s3Client || !process.env.S3_BUCKET_NAME) return;
    try {
      const data = JSON.stringify(this.state, null, 2);
      const timestamp = new Date().toISOString();
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.s3Bucket,
        Key: 'snapshots/memory-latest.json',
        Body: data,
        ContentType: 'application/json'
      }));
      this.state.lastSnapshotAt = Date.now();
      console.log(`[Sentient Memory] Saved memory snapshot to S3 at ${timestamp}.`);
    } catch (err) {
      console.warn(`[Sentient Memory] S3 snapshot note: ${err.message}`);
    }
  }

  startPeriodicSnapshot() {
    setInterval(() => {
      this.snapshotToS3();
    }, SNAPSHOT_INTERVAL_MS);
  }

  // --- Public API ---

  async load() {
    await this.loadFromRedis();
    return this.getState();
  }

  getState() {
    this.checkDailyRollover();
    return {
      episodes: this.state.episodes,
      intuition: this.state.intuition,
      fitnessHist: this.state.fitnessHist,
      genome: this.state.genome,
      genomeBase: this.state.genomeBase,
      generation: this.state.generation,
      proposalsToday: this.state.proposalsToday,
      signatureLog: this.state.signatureLog,
      lastSnapshotAt: this.state.lastSnapshotAt
    };
  }

  getMemory() {
    return this.getState();
  }

  learn(episode) {
    return this.recordEpisode(episode);
  }

  recordEpisode(episode) {
    this.checkDailyRollover();
    this.state.episodes.unshift({
      at: episode.at || Date.now(),
      jobId: episode.jobId,
      clientId: episode.clientId,
      proposalStyle: episode.proposalStyle,
      hook: episode.hook || '',
      outcome: episode.outcome,
      deltaFitness: episode.deltaFitness || 0,
      earnings: episode.earnings || 0,
      category: episode.category || 'general'
    });

    if (this.state.episodes.length > 200) {
      this.state.episodes.length = 200;
    }

    // Intuition matrix update: keyed "jobCategory|proposalStyle"
    const key = `${episode.category || 'general'}|${episode.proposalStyle}`;
    if (!this.state.intuition[key]) {
      this.state.intuition[key] = { trust: 0.50, uses: 0, burns: 0 };
    }

    const intu = this.state.intuition[key];
    intu.uses += 1;
    const decay = this.state.genome.trustDecay || 0.90;

    if (episode.outcome === 'reply') {
      // reply -> trust += (1 - trust) * 0.24 * trustDecay
      intu.trust += (1 - intu.trust) * 0.24 * decay;
    } else if (episode.outcome === 'silence') {
      // silence -> trust *= 0.93
      intu.trust *= 0.93;
    } else if (episode.outcome === 'reject') {
      // reject -> trust *= (0.55 + (1 - trustDecay) * 0.2)
      intu.trust *= (0.55 + (1 - decay) * 0.2);
      intu.burns += 1; // burns NEVER reset
    }
    intu.trust = Math.max(0.02, Math.min(0.99, Number(intu.trust.toFixed(3))));

    this.saveToRedis();
    return intu;
  }

  recordFitness(fitnessScore) {
    this.state.fitnessHist.push({
      t: Date.now(),
      fitness: Math.max(0, Math.min(1, Number(fitnessScore.toFixed(3))))
    });
    if (this.state.fitnessHist.length > 300) {
      this.state.fitnessHist.shift();
    }
    this.saveToRedis();
  }

  mutateGenome(rollingReplyRate) {
    const genes = ['sensitivity', 'aggressiveness', 'caution', 'horizon', 'polishGain', 'trustDecay'];
    const gene = genes[Math.floor(Math.random() * genes.length)];
    const bounds = {
      sensitivity: [0.25, 0.92],
      aggressiveness: [0.15, 0.95],
      caution: [0.15, 0.90],
      horizon: [8, 40],
      polishGain: [0.55, 1.90],
      trustDecay: [0.75, 0.98]
    };

    const delta = (Math.random() - 0.5) * (gene === 'horizon' ? 4 : 0.08);
    const [min, max] = bounds[gene];
    const prevVal = this.state.genome[gene];
    const newVal = Math.max(min, Math.min(max, Number((prevVal + delta).toFixed(3))));

    this.state.genome[gene] = newVal;
    this.state.generation += 1;
    this.saveToRedis();

    return {
      gene,
      prevVal,
      newVal,
      direction: newVal >= prevVal ? 'up' : 'down',
      generation: this.state.generation
    };
  }

  setGene(gene, value, reason, shadowFit, narratorLine) {
    const prevVal = this.state.genome[gene] ?? DEFAULT_GENOME[gene];
    const newVal = Number(Number(value).toFixed(3));
    this.state.genome[gene] = newVal;
    this.state.generation += 1;
    this.saveToRedis();

    return {
      gene,
      prevVal,
      newVal,
      direction: newVal >= prevVal ? 'up' : 'down',
      generation: this.state.generation,
      reason: reason || 'autonomous adaptation',
      shadowFit: shadowFit || null,
      narratorLine: narratorLine || `Generation ${this.state.generation}: Shifted ${gene} from ${prevVal} to ${newVal}.`
    };
  }

  resetGenome() {
    // genomeBase snapshot allows RESET while preserving intuition and episodes
    this.state.genome = { ...this.state.genomeBase };
    console.log('[Sentient Memory] Genome reset to base. Intuition and episodes preserved.');
    this.saveToRedis();
    return this.state.genome;
  }

  recordSignature(sig) {
    this.checkDailyRollover();
    this.state.signatureLog.push({
      timestamp: sig.timestamp || Date.now(),
      firstSentence: (sig.firstSentence || '').trim().toLowerCase(),
      sentenceStructureHash: sig.sentenceStructureHash || '',
      jobCategory: sig.jobCategory || 'general'
    });

    this.state.proposalsToday += 1;

    // Retain 60-day window
    const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
    this.state.signatureLog = this.state.signatureLog.filter(s => s.timestamp >= sixtyDaysAgo);

    this.saveToRedis();
  }

  recentSignatures() {
    return this.state.signatureLog;
  }

  async snapshot() {
    await this.snapshotToS3();
    return { ok: true, lastSnapshotAt: this.state.lastSnapshotAt };
  }

  health() {
    const isRedisConnected = !!(this.redisClient && this.redisClient.status === 'ready');
    return {
      ok: true,
      redis: isRedisConnected ? 'connected' : 'in_memory_fallback',
      episodesCount: this.state.episodes.length,
      intuitionCount: Object.keys(this.state.intuition).length,
      generation: this.state.generation,
      lastSnapshotAt: this.state.lastSnapshotAt
    };
  }

  // --- Proposal Approval Queue Operations ---

  async enqueueProposal(proposal) {
    const item = {
      id: proposal.id || `prop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      jobId: proposal.jobId,
      jobTitle: proposal.jobTitle || 'Freelance Engagement',
      client: proposal.client || 'Verified Client',
      budget: proposal.budget || 'TBD',
      proposalText: proposal.proposalText,
      style: proposal.style || 'personalized_hook',
      voice: proposal.voice || 'direct',
      hook: proposal.hook || '',
      queuedAt: Date.now(),
      status: 'pending_approval'
    };

    // Store in local queue
    this.localQueue.push(item);

    if (this.redisClient) {
      try {
        await this.redisClient.rpush(QUEUE_REDIS_KEY, JSON.stringify(item));
      } catch (err) {
        console.warn(`[Sentient Memory] Redis enqueue note: ${err.message}`);
      }
    }

    return item;
  }

  async listProposals() {
    return this.getQueue();
  }

  async getQueue() {
    if (this.redisClient && this.redisClient.status === 'ready') {
      try {
        const raw = await this.redisClient.lrange(QUEUE_REDIS_KEY, 0, -1);
        if (raw && raw.length > 0) {
          return raw.map(i => JSON.parse(i));
        }
      } catch (err) {
        console.warn(`[Sentient Memory] Redis queue fetch note: ${err.message}`);
      }
    }
    return this.localQueue;
  }

  async updateProposal(id, updates) {
    return this.updateQueueItem(id, updates);
  }

  async updateQueueItem(id, updates) {
    // Update local queue
    const localIdx = this.localQueue.findIndex(i => i.id === id);
    if (localIdx !== -1) {
      this.localQueue[localIdx] = { ...this.localQueue[localIdx], ...updates, updatedAt: Date.now() };
    }

    if (this.redisClient && this.redisClient.status === 'ready') {
      try {
        const items = await this.getQueue();
        const idx = items.findIndex(i => i.id === id);
        if (idx !== -1) {
          items[idx] = { ...items[idx], ...updates, updatedAt: Date.now() };
          await this.redisClient.del(QUEUE_REDIS_KEY);
          if (items.length > 0) {
            const serialized = items.map(i => JSON.stringify(i));
            await this.redisClient.rpush(QUEUE_REDIS_KEY, ...serialized);
          }
          return items[idx];
        }
      } catch (err) {
        console.warn(`[Sentient Memory] Redis queue update note: ${err.message}`);
      }
    }

    return localIdx !== -1 ? this.localQueue[localIdx] : null;
  }

  async removeProposal(id) {
    const localIdx = this.localQueue.findIndex(i => i.id === id);
    if (localIdx !== -1) {
      this.localQueue.splice(localIdx, 1);
    }

    if (this.redisClient && this.redisClient.status === 'ready') {
      try {
        const items = await this.getQueue();
        const filtered = items.filter(i => i.id !== id);
        await this.redisClient.del(QUEUE_REDIS_KEY);
        if (filtered.length > 0) {
          const serialized = filtered.map(i => JSON.stringify(i));
          await this.redisClient.rpush(QUEUE_REDIS_KEY, ...serialized);
        }
      } catch (err) {
        console.warn(`[Sentient Memory] Redis queue remove note: ${err.message}`);
      }
    }

    return { ok: true, removedId: id };
  }
}

export const memory = new MemoryManager();
