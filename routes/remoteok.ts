import express from 'express';
import {
  fetchLivePlatformJobs,
  fetchRemoteOKJobsFromApi,
  fetchWWRJobsFromApi,
  fetchFlexJobsFromApi,
  getPlatformStatus,
  NormalizedWorkOrder
} from '../server/platformIntegrations.js';

const router = express.Router();

let cachedUnifiedJobs: NormalizedWorkOrder[] = [];
let lastFetchedAt = 0;
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * GET /api/remoteok/jobs
 * Returns live jobs from Remote OK, We Work Remotely, and FlexJobs
 */
router.get('/jobs', async (req, res) => {
  const query = (req.query.q as string) || (req.query.tag as string) || '';
  const now = Date.now();

  try {
    if (cachedUnifiedJobs.length > 0 && now - lastFetchedAt < CACHE_TTL_MS && !query) {
      return res.json(cachedUnifiedJobs);
    }

    const { jobs, source } = await fetchLivePlatformJobs(query);
    if (jobs.length > 0) {
      cachedUnifiedJobs = jobs;
      lastFetchedAt = now;
    }

    res.json(jobs.length > 0 ? jobs : cachedUnifiedJobs);
  } catch (err: any) {
    console.error('Error fetching jobs:', err.message);
    res.json(cachedUnifiedJobs);
  }
});

/**
 * GET /api/remoteok/status
 * Check configured platform credentials & API status
 */
router.get('/status', (req, res) => {
  const status = getPlatformStatus();
  res.json({
    success: true,
    status,
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /api/remoteok/sync
 * Manually trigger a fresh live sync from all job platforms
 */
router.post('/sync', async (req, res) => {
  try {
    const query = req.body?.query || '';
    const { jobs, source, platformsChecked } = await fetchLivePlatformJobs(query);
    cachedUnifiedJobs = jobs;
    lastFetchedAt = Date.now();

    res.json({
      success: true,
      syncedCount: jobs.length,
      source,
      platformsChecked,
      jobs: jobs.slice(0, 50)
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
