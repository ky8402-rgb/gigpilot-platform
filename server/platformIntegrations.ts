import axios from 'axios';

export interface NormalizedWorkOrder {
  id: number | string;
  externalId?: string;
  title: string;
  platform: 'Upwork' | 'Contra' | 'Freelancer' | string;
  status: 'in-progress' | 'pending' | 'urgent' | 'completed';
  amount: number;
  category: string;
  time: string;
  client: {
    name: string;
    country?: string;
    rating?: number;
    totalSpent?: number;
    paymentVerified?: boolean;
  };
  description?: string;
  skills?: string[];
  milestones?: {
    id: string;
    title: string;
    amount: number;
    completed: boolean;
  }[];
  platformUrl?: string;
  location?: string;
  salaryMin?: number;
  salaryMax?: number;
}

export interface PlatformStatus {
  upwork: {
    connected: boolean;
    authMethod: string;
    endpoint: string;
    lastPing: string;
    tokenConfigured: boolean;
  };
  contra: {
    connected: boolean;
    authMethod: string;
    endpoint: string;
    lastPing: string;
    apiKeyConfigured: boolean;
  };
  freelancer: {
    connected: boolean;
    authMethod: string;
    endpoint: string;
    lastPing: string;
    tokenConfigured: boolean;
  };
  paypal: {
    connected: boolean;
    mode: 'live' | 'sandbox' | 'unconfigured';
    receiverEmail: string;
    paypalMeUsername: string;
  };
  autonomous: {
    biddingEnabled: boolean;
    executionEnabled: boolean;
    freelancerCredentialsConfigured: boolean;
  };
}

const SUPPORTED_JOB_KEYWORDS = [
  // 1. Data scraping (CSV, JSON, Excel | Python, Scrapy, Puppeteer)
  'scrape', 'scraping', 'extract', 'extraction', 'data mining', 'crawl', 'harvest', 'directory', 'lead generation', 'puppeteer', 'scrapy', 'beautifulsoup',
  // 2. Data entry & conversion (Excel, CSV, Word | OCR, pandas, openpyxl)
  'data entry', 'pdf to excel', 'pdf to csv', 'image to text', 'ocr', 'csv cleanup', 'merge files', 'clean data', 'openpyxl', 'pandas', 'excel conversion',
  // 3. Content writing (Google Doc, Word, text | LLM GPT/Claude)
  'content writing', 'blog post', 'product description', 'seo article', 'article writing', 'copywriting', 'newsletter', 'summary writing', 'technical writing',
  // 4. Translation (Text, SRT | Translation API)
  'translation', 'translate', 'subtitles translation', 'spanish translation', 'german translation', 'french translation', 'multilingual', 'bilingual',
  // 5. Transcription (SRT, VTT, text | Whisper, speech-to-text)
  'transcription', 'transcribe', 'audio to text', 'video to text', 'whisper', 'speech to text', 'subtitles', 'vtt', 'srt',
  // 6. Simple coding (.py, .js, .gs | Code generation + testing)
  'python script', 'excel macro', 'google sheets automation', 'apps script', '.gs', 'bug fix', 'macro', 'vba', 'automate task', 'small script',
  // 7. Image processing (PNG, JPG | PIL, OpenCV, AI models)
  'image processing', 'background removal', 'resize images', 'watermark', 'format conversion', 'png to jpg', 'webp', 'opencv', 'pillow', 'pil',
  // 8. SEO & research (Spreadsheet, report | APIs, LLM)
  'seo', 'keyword research', 'competitor analysis', 'lead list', 'b2b leads', 'market research', 'serp',
  // 9. PDF & document automation (PDF, Excel | PDF libraries)
  'pdf automation', 'fill forms', 'generate invoices', 'extract tables', 'reportlab', 'pdfkit', 'pdfplumber', 'invoice generator',
  // 10. Social media content (Text, CSV | LLM + platform API)
  'social media content', 'generate posts', 'captions', 'hashtags', 'schedule via api', 'linkedin post', 'twitter thread', 'instagram caption', 'content calendar'
];

export function isSupportedJobGig(title: string = '', description: string = ''): boolean {
  const combined = `${title} ${description}`.toLowerCase();
  return SUPPORTED_JOB_KEYWORDS.some(kw => combined.includes(kw));
}

// Retain alias for backwards compatibility
export const isScrapingGig = isSupportedJobGig;

// In-Memory Store for synced live orders
let liveWorkOrders: NormalizedWorkOrder[] = [];

/**
 * Check connectivity and credentials status for all integrated platforms
 */
export function getPlatformStatus(): PlatformStatus {
  const upworkToken = process.env.UPWORK_OAUTH_TOKEN;
  const contraKey = process.env.CONTRA_API_KEY;
  const flToken = process.env.FREELANCER_ACCESS_TOKEN || process.env.FREELANCER_API_KEY || process.env.FREELANCER_OAUTH_TOKEN;
  const paypalClientId = process.env.PAYPAL_CLIENT_ID;
  const paypalSecret = process.env.PAYPAL_CLIENT_SECRET;
  const paypalReceiver = process.env.PAYPAL_RECEIVER_EMAIL || '';
  const paypalMeUser = process.env.PAYPAL_ME_USERNAME || '';
  const isPaypalLive = process.env.PAYPAL_MODE === 'live';
  const freelancerCredentialsConfigured = Boolean(flToken && flToken.trim().length > 0);
  const biddingEnabled = process.env.AUTONOMOUS_BIDDING_ENABLED === 'true';
  const executionEnabled = process.env.AUTONOMOUS_EXECUTION_ENABLED === 'true';

  return {
    upwork: {
      connected: Boolean(upworkToken),
      authMethod: 'Official API (OAuth 2.0 Token)',
      endpoint: 'https://api.upwork.com/v2/market/jobs/url',
      lastPing: new Date().toISOString(),
      tokenConfigured: Boolean(upworkToken && upworkToken.trim().length > 0)
    },
    contra: {
      connected: Boolean(contraKey && contraKey.trim().length > 0),
      authMethod: 'Freelance Marketplace API',
      endpoint: 'https://api.contra.com/api/v1/opportunities',
      lastPing: new Date().toISOString(),
      apiKeyConfigured: Boolean(contraKey && contraKey.trim().length > 0)
    },
    freelancer: {
      connected: Boolean(flToken),
      authMethod: 'Freelancer.com REST API (Bearer)',
      endpoint: 'https://www.freelancer.com/api/projects/0.1/projects/active',
      lastPing: new Date().toISOString(),
      tokenConfigured: Boolean(flToken && flToken.trim().length > 0)
    },
    paypal: {
      connected: Boolean(paypalClientId && paypalSecret),
      mode: paypalClientId && paypalSecret ? (isPaypalLive ? 'live' : 'sandbox') : 'unconfigured',
      receiverEmail: paypalReceiver,
      paypalMeUsername: paypalMeUser
    },
    autonomous: {
      biddingEnabled,
      executionEnabled,
      freelancerCredentialsConfigured
    }
  };
}

/**
 * Fetch and sync scraping jobs from Upwork official API via OAuth
 */
export async function fetchUpworkJobsFromApi(query: string = ''): Promise<NormalizedWorkOrder[]> {
  const upworkToken = process.env.UPWORK_OAUTH_TOKEN;
  
  if (upworkToken) {
    try {
      const response = await axios.get('https://api.upwork.com/v2/market/jobs/url', {
        headers: {
          'Authorization': `Bearer ${upworkToken.trim()}`,
          'User-Agent': 'KUNDANVISION369-Agent/1.0'
        },
        params: { q: query || 'scraping extraction "lead generation"', count: 25 },
        timeout: 10000
      });
      const data = response.data?.jobs || [];
      return data
        .filter((j: any) => isScrapingGig(j.title, j.snippet || j.description))
        .map((j: any, i: number): NormalizedWorkOrder => ({
          id: `upwork_${j.id || i + 1}`,
          externalId: String(j.id || `upwork_${Date.now()}_${i}`),
          title: j.title || 'Data Scraping & Extraction Contract',
          platform: 'Upwork',
          status: 'pending',
          amount: Number.isFinite(Number(j.budget)) ? Number(j.budget) : 0,
          category: 'Web Scraping & Data Extraction',
          time: j.date_created ? new Date(j.date_created).toLocaleDateString() : 'Just now',
          client: {
            name: j.client?.company_name || j.client?.name || 'Upwork Client',
            country: j.client?.country || 'Unknown',
            rating: Number.isFinite(Number(j.client?.feedback)) ? Number(j.client.feedback) : undefined,
            totalSpent: Number.isFinite(Number(j.client?.total_spent)) ? Number(j.client.total_spent) : undefined,
            paymentVerified: typeof j.client?.payment_verified === 'boolean' ? j.client.payment_verified : undefined
          },
          description: (j.snippet || j.description || '').replace(/<[^>]*>?/gm, '').slice(0, 320) + '...',
          skills: Array.isArray(j.skills) ? j.skills : ['Python', 'Web Scraping', 'CSV Export'],
          platformUrl: j.url || `https://upwork.com/jobs/~${j.id}`,
          location: j.client?.country || 'Worldwide',
          salaryMin: Number(j.budget) || 99,
          salaryMax: Number(j.budget) || 799
        }));
    } catch (err: any) {
      console.warn('[Upwork Live Sync] Notice:', err.message);
    }
  }
  // Never fabricate marketplace listings. If the official API is unavailable or unauthenticated,
  // return an empty result and let the caller surface the disconnected state.
  return [];
}

/**
 * Fetch and sync scraping jobs from Contra marketplace
 */
export async function fetchContraJobsFromApi(query: string = ''): Promise<NormalizedWorkOrder[]> {
  const contraKey = (process.env.CONTRA_API_KEY || '').trim();
  if (!contraKey) return [];
  try {
    const response = await axios.get('https://api.contra.com/api/v1/opportunities', {
      headers: {
        'User-Agent': 'KUNDANVISION369-Agent/1.0',
        Authorization: `Bearer ${contraKey.trim()}`
      },
      params: { role: 'Scraping & Lead Generation', limit: 25 },
      timeout: 8000,
      validateStatus: (status) => status < 500
    });
    if (response.status === 200) {
      const items = response.data?.opportunities || [];
      const filtered = items.filter((j: any) => isScrapingGig(j.title, j.description));
      if (filtered.length > 0) {
        return filtered.map((j: any, i: number): NormalizedWorkOrder => ({
          id: `contra_${j.id || i + 1}`,
          externalId: String(j.id || `contra_${Date.now()}_${i}`),
          title: j.title || 'Data Extraction & Lead Harvester',
          platform: 'Contra',
          status: 'pending',
          amount: Number(j.budget) || 199,
          category: 'Web Scraping & Extraction',
          time: j.createdAt ? new Date(j.createdAt).toLocaleDateString() : 'Active',
          client: {
            name: j.clientName || 'Contra Client',
            country: j.clientCountry || 'Unknown',
            rating: Number.isFinite(Number(j.clientRating)) ? Number(j.clientRating) : undefined,
            totalSpent: Number.isFinite(Number(j.clientTotalSpent)) ? Number(j.clientTotalSpent) : undefined,
            paymentVerified: typeof j.paymentVerified === 'boolean' ? j.paymentVerified : undefined
          },
          description: (j.description || '').replace(/<[^>]*>?/gm, '').slice(0, 320) + '...',
          skills: Array.isArray(j.skills) ? j.skills : ['Web Scraping', 'Data Mining', 'CSV'],
          platformUrl: j.url || `https://contra.com/p/${j.id}`,
          location: 'Remote',
          salaryMin: 99,
          salaryMax: 399
        }));
      }
    }
  } catch (err: any) {
    if (err.response?.status !== 404) {
      console.warn('[Contra Live Sync] Notice:', err.message);
    }
  }
  return [];
}

/**
 * Fetch and sync scraping jobs from Freelancer.com
 */
export async function fetchFreelancerJobsFromApi(query: string = ''): Promise<NormalizedWorkOrder[]> {
  const flToken = process.env.FREELANCER_ACCESS_TOKEN || process.env.FREELANCER_API_KEY || process.env.FREELANCER_OAUTH_TOKEN;
  const headers: Record<string, string> = {
    'User-Agent': 'KUNDANVISION369-Agent/1.0',
    'Accept': 'application/json'
  };
  if (flToken) {
    headers['Authorization'] = `Bearer ${flToken.trim()}`;
  }

  try {
    const response = await axios.get('https://www.freelancer.com/api/projects/0.1/projects/active', {
      headers,
      params: {
        query: query || 'data extraction python automation transcription image',
        compact: 'true',
        limit: 15
      },
      timeout: 8000
    });
    const items = response.data?.result?.projects || [];
    return items
      .filter((j: any) => isSupportedJobGig(j.title, j.preview_description || j.description))
      .map((j: any, i: number): NormalizedWorkOrder => {
        const budgetMin = j.budget?.minimum || 99;
        const budgetMax = j.budget?.maximum || 399;
        return {
          id: `fl_${j.id || i + 1}`,
          externalId: String(j.id || `fl_${Date.now()}_${i}`),
          title: j.title || 'Automated Work Order Project',
          platform: 'Freelancer',
          status: 'pending',
          amount: Math.round((budgetMin + budgetMax) / 2),
          category: 'Autonomous Work Order',
          time: j.submitdate ? new Date(j.submitdate * 1000).toLocaleDateString() : 'Active',
          client: {
            name: j.owner?.username || 'Freelancer Client',
            country: j.owner?.country || 'Unknown',
            rating: Number.isFinite(Number(j.owner?.rating)) ? Number(j.owner.rating) : undefined,
            totalSpent: Number.isFinite(Number(j.owner?.total_spent)) ? Number(j.owner.total_spent) : undefined,
            paymentVerified: typeof j.owner?.payment_verified === 'boolean' ? j.owner.payment_verified : undefined
          },
          description: (j.preview_description || j.description || '').replace(/<[^>]*>?/gm, '').slice(0, 320) + '...',
          skills: ['Data Mining', 'Python', 'CSV', 'Automation'],
          platformUrl: `https://www.freelancer.com/projects/${j.id}`,
          location: 'Remote',
          salaryMin: budgetMin,
          salaryMax: budgetMax
        };
      });
  } catch (err: any) {
    console.warn('[Freelancer Live Sync] Notice:', err.message);
  }
  return [];
}

/** Real RemoteOK public feed. RemoteOK is a job board, not a contract/award API. */
export async function fetchRemoteOKJobsFromApi(query: string = ''): Promise<NormalizedWorkOrder[]> {
  try {
    const response = await axios.get('https://remoteok.com/api', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'GigPilot/1.0 (+https://main.d2qe2q720fbn3x.amplifyapp.com/)' },
      timeout: 10000
    });
    const items = Array.isArray(response.data) ? response.data.slice(1) : [];
    const q = query.trim().toLowerCase();
    return items
      .filter((j: any) => j && j.id && (!q || `${j.position || ''} ${j.description || ''} ${(j.tags || []).join(' ')}`.toLowerCase().includes(q)))
      .filter((j: any) => isSupportedJobGig(j.position || j.title, j.description || ''))
      .map((j: any): NormalizedWorkOrder => ({
        id: `remoteok_${j.id}`,
        externalId: String(j.id),
        title: String(j.position || j.title || 'Remote opportunity').slice(0, 250),
        platform: 'RemoteOK',
        status: 'pending',
        amount: Number(j.salary_min || j.salary_max || 0),
        category: 'Remote Job Board',
        time: j.date ? new Date(j.date).toLocaleDateString() : 'Active',
        client: {
          name: String(j.company || 'RemoteOK employer').slice(0, 100),
          country: j.location || 'Remote',
          paymentVerified: false
        },
        description: String(j.description || '').replace(/<[^>]*>?/gm, '').slice(0, 1000),
        skills: Array.isArray(j.tags) ? j.tags.map(String).slice(0, 20) : [],
        platformUrl: j.url || j.apply_url || `https://remoteok.com/remote-jobs/${j.slug || j.id}`,
        location: j.location || 'Remote',
        salaryMin: Number(j.salary_min || 0) || undefined,
        salaryMax: Number(j.salary_max || 0) || undefined
      }));
  } catch (err: any) {
    console.warn('[RemoteOK Live Sync] Notice:', err.message);
    return [];
  }
}

/** We Work Remotely and FlexJobs do not expose a supported authenticated contract API here. */
export const fetchWWRJobsFromApi = async (_query: string = ''): Promise<NormalizedWorkOrder[]> => [];
export const fetchFlexJobsFromApi = async (_query: string = ''): Promise<NormalizedWorkOrder[]> => [];

/**
 * Unified live platform job ingestion. Public job boards are leads; marketplace contracts require provider confirmation.
 */
export async function fetchLivePlatformJobs(query: string = ''): Promise<{
  jobs: NormalizedWorkOrder[];
  source: 'live_api' | 'cached_stream';
  platformsChecked: string[];
}> {
  const platformsChecked = ['RemoteOK (public feed)', 'Upwork (OAuth)', 'Contra (API)', 'Freelancer.com (OAuth)'];
  const [remoteOk, upwork, contra, freelancer] = await Promise.allSettled([
    fetchRemoteOKJobsFromApi(query),
    fetchUpworkJobsFromApi(query),
    fetchContraJobsFromApi(query),
    fetchFreelancerJobsFromApi(query)
  ]);
  const fetched: NormalizedWorkOrder[] = [];
  for (const r of [remoteOk, upwork, contra, freelancer]) {
    if (r.status === 'fulfilled') fetched.push(...r.value);
  }
  const existingIds = new Set<string>();
  const deduped = fetched.filter(item => {
    const key = `${item.platform}:${item.externalId || item.id}`;
    if (existingIds.has(key)) return false;
    existingIds.add(key);
    return true;
  });
  if (deduped.length) {
    liveWorkOrders = deduped.concat(liveWorkOrders.filter(o => !existingIds.has(`${o.platform}:${o.externalId || o.id}`))).slice(0, 100);
    return { jobs: liveWorkOrders, source: 'live_api', platformsChecked };
  }
  return { jobs: liveWorkOrders, source: 'cached_stream', platformsChecked };
}

/** Submit only a real, provider-confirmed proposal. Never synthesize an external bid id. */
export async function submitPlatformBid(orderId: number | string, proposalData: {
  bidAmount: number;
  deliveryDays: number;
  coverLetter: string;
  milestones?: { title: string; amount: number }[];
}): Promise<{ success: boolean; externalBidId?: string; platform: string; message: string; error?: string }> {
  const targetOrder = liveWorkOrders.find(o => String(o.id) === String(orderId) || o.externalId === String(orderId));
  if (!targetOrder) throw new Error('LIVE_JOB_NOT_FOUND: The requested live job is not in the current provider feed.');

  if (targetOrder.platform === 'Freelancer') {
    const token = (process.env.FREELANCER_ACCESS_TOKEN || process.env.FREELANCER_API_KEY || process.env.FREELANCER_OAUTH_TOKEN || '').trim();
    if (!token) {
      return { success: false, platform: 'Freelancer', message: 'Freelancer OAuth/API credentials are not configured; no bid was submitted.', error: 'FREELANCER_NOT_CONFIGURED' };
    }
    const projectId = String(targetOrder.externalId || targetOrder.id).replace(/^fl_/, '');
    const base = (process.env.FREELANCER_API_BASE_URL || process.env.FREELANCER_API_BASE || process.env.FREELANCER_API_URL || 'https://www.freelancer.com/api').replace(/\/+$/, '');
    try {
      const response = await axios.post(`${base}/projects/0.1/bids/`, {
        project_id: Number(projectId),
        bidder_id: null,
        amount: Number(proposalData.bidAmount),
        period: Math.max(1, Number(proposalData.deliveryDays) || 5),
        description: proposalData.coverLetter,
        milestone_percentage: 100
      }, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        timeout: 15000
      });
      const bidId = response.data?.result?.id;
      if (!bidId) throw new Error('FREELANCER_BID_UNCONFIRMED: Provider returned no bid id.');
      return { success: true, externalBidId: String(bidId), platform: 'Freelancer', message: 'Freelancer bid submitted and confirmed by the provider.' };
    } catch (err: any) {
      return { success: false, platform: 'Freelancer', message: 'Freelancer bid submission failed; no external success was recorded.', error: err.response?.data?.message || err.message };
    }
  }

  return { success: false, platform: targetOrder.platform, message: `No supported bid-submission API is configured for ${targetOrder.platform}; the job remains a lead only.`, error: 'BID_PROVIDER_UNSUPPORTED' };
}

export function getAllLiveOrders(): NormalizedWorkOrder[] {
  return liveWorkOrders;
}

export function completeLiveOrder(_id: number | string): NormalizedWorkOrder | null {
  return null;
}
