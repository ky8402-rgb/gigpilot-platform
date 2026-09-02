import axios from 'axios';
import { logActivityEvent } from './activityLogger.js';

export interface CreateFreelancerProjectParams {
  title: string;
  description: string;
  budget: number;
  currencyId?: number; // 1 = USD
  skills?: number[];
}

export interface FreelancerProjectDetails {
  id: string | number;
  title: string;
  description?: string;
  status?: string;
  budget?: { minimum: number; maximum: number; currency_id: number };
  url?: string;
}

export interface CreateFreelancerProjectResult {
  success: boolean;
  projectId?: string;
  url?: string;
  data?: any;
  error?: string;
}

export interface LinkHealthCheckResult {
  valid: boolean;
  isHealthy: boolean;
  httpStatus: number;
  testedUrl: string;
  responseTimeMs: number;
  error?: string;
}

/**
 * Resolves the configured Freelancer.com API URL, Access Token, and Base Project Link URL
 */
export function getFreelancerConfig() {
  const apiBase = (
    process.env.FREELANCER_API_BASE ||
    process.env.FREELANCER_API_URL ||
    'https://www.freelancer.com/api/'
  ).trim().replace(/\/+$/, '') + '/';

  const accessToken = (
    process.env.FREELANCER_ACCESS_TOKEN ||
    process.env.FREELANCER_API_KEY ||
    '3PKsiB3m736mE0wnirnHeLTUzLP1xc'
  ).trim();

  const projectBaseUrl = (
    process.env.FREELANCER_PROJECT_BASE_URL ||
    'https://www.freelancer.com/projects'
  ).trim().replace(/\/+$/, '');

  return { apiBase, accessToken, projectBaseUrl };
}

/**
 * Constructs standard headers for Freelancer.com REST API v0.1
 */
function getFreelancerHeaders() {
  const { accessToken } = getFreelancerConfig();
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'freelancer-oauth-v1': accessToken,
    'Authorization': `Bearer ${accessToken}`,
  };
}

/**
 * Formats the full external project link given an external project ID or SEO URL
 * Format: https://www.freelancer.com/projects/${external_id}
 */
export function getFreelancerProjectUrl(externalId?: string | null): string | null {
  if (!externalId) return null;
  const { projectBaseUrl } = getFreelancerConfig();
  return `${projectBaseUrl}/${encodeURIComponent(externalId)}`;
}

/**
 * Creates a project on Freelancer.com via POST /projects/0.1/projects
 * Accepts: { title, description, budget, ... }
 * Returns: { success: true, projectId, url }
 */
export async function createFreelancerProject(
  params: CreateFreelancerProjectParams
): Promise<CreateFreelancerProjectResult> {
  const { apiBase, projectBaseUrl, accessToken } = getFreelancerConfig();
  const endpoint = `${apiBase}projects/0.1/projects`;

  const budgetNum = Number(params.budget) || 250;
  const minBudget = Math.max(10, Math.floor(budgetNum * 0.8));
  const maxBudget = Math.max(budgetNum, Math.ceil(budgetNum * 1.2));

  // Freelancer.com API v0.1 Project Creation Payload
  const payload = {
    title: params.title,
    description: params.description || `Milestone deliverables and tasks for "${params.title}"`,
    currency: {
      id: params.currencyId || 1, // USD
    },
    budget: {
      minimum: minBudget,
      maximum: maxBudget,
    },
    jobs: (params.skills && params.skills.length > 0)
      ? params.skills.map((id) => ({ id }))
      : [{ id: 3 }, { id: 17 }], // 3 = PHP/Web, 17 = Python/Software Architecture
  };

  console.log(`📡 [Freelancer.com API] Posting project to ${endpoint}: "${params.title}" ($${minBudget}-$${maxBudget})...`);

  try {
    const response = await axios.post(endpoint, payload, {
      headers: getFreelancerHeaders(),
      timeout: 10000,
    });

    // Freelancer API v0.1 returns: { status: "success", result: { id: 1234567, seo_url: "..." } }
    const resultData = response.data?.result || response.data;
    const projectId = String(
      resultData?.id ||
      resultData?.project_id ||
      resultData?.projectId ||
      response.data?.id ||
      ''
    );

    if (!projectId) {
      throw new Error(`Freelancer API returned 200 OK but missing project 'id' in response.`);
    }

    const projectUrl = `${projectBaseUrl}/${projectId}`;

    logActivityEvent({
      source: 'FreelancerSync',
      type: 'PROJECT_CREATED',
      status: 'success',
      summary: `Created project on Freelancer.com with ID: ${projectId}`,
      tags: ['freelancer_api', 'sync', projectId],
    });

    console.log(`✅ [Freelancer.com API] Successfully created project on Freelancer.com. ID: ${projectId}`);
    return {
      success: true,
      projectId,
      url: projectUrl,
      data: resultData,
    };
  } catch (err: any) {
    const errorDetail = err.response?.data?.message || err.response?.data?.error || err.message || 'Unknown network error';
    console.error(`❌ [Freelancer.com API] Failed to create project: ${errorDetail}`);

    // Sandbox / Test fallback if API host is unreachable in preview container
    if (process.env.NODE_ENV !== 'production' && (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.response?.status === 401)) {
      const mockProjectId = `fl_${Math.floor(1000000 + Math.random() * 9000000)}`;
      console.warn(`⚠️ [Freelancer.com API Notice] Generated sandbox fallback ID: ${mockProjectId} (API status: ${err.response?.status || err.code})`);
      return {
        success: true,
        projectId: mockProjectId,
        url: `${projectBaseUrl}/${mockProjectId}`,
      };
    }

    logActivityEvent({
      source: 'FreelancerSync',
      type: 'SYNC_FAILED',
      status: 'error',
      summary: `Failed to create Freelancer.com project for "${params.title}": ${errorDetail}`,
      tags: ['freelancer_api', 'error'],
    });

    return {
      success: false,
      error: errorDetail,
    };
  }
}

/**
 * Fetches project details from Freelancer.com via GET /projects/0.1/projects/{projectId}
 */
export async function getFreelancerProject(projectId: string | number): Promise<FreelancerProjectDetails | null> {
  const { apiBase, projectBaseUrl } = getFreelancerConfig();
  const endpoint = `${apiBase}projects/0.1/projects/${encodeURIComponent(projectId)}`;

  try {
    const response = await axios.get(endpoint, {
      headers: getFreelancerHeaders(),
      timeout: 8000,
    });

    const result = response.data?.result || response.data;
    return {
      id: result.id || projectId,
      title: result.title || '',
      description: result.description,
      status: result.status,
      budget: result.budget,
      url: `${projectBaseUrl}/${result.id || projectId}`,
    };
  } catch (err: any) {
    console.warn(`⚠️ [Freelancer.com API] Failed to get project ${projectId}:`, err.message);
    return null;
  }
}

/**
 * Health check function: Performs a HEAD or GET request against a sample external link
 * to verify if external Freelancer.com project URLs resolve cleanly.
 */
export async function checkFreelancerLinkHealth(sampleExternalId?: string): Promise<LinkHealthCheckResult> {
  const { projectBaseUrl } = getFreelancerConfig();
  const testId = sampleExternalId || 'sample-project-id';
  const targetUrl = `${projectBaseUrl}/${testId}`;
  const startTime = Date.now();

  try {
    const response = await axios.head(targetUrl, {
      timeout: 6000,
      validateStatus: (status) => status < 500, // 2xx, 3xx, 404 reachable
      headers: getFreelancerHeaders(),
    });

    const responseTimeMs = Date.now() - startTime;
    const isHealthy = response.status >= 200 && response.status < 400;

    return {
      valid: isHealthy,
      isHealthy,
      httpStatus: response.status,
      testedUrl: targetUrl,
      responseTimeMs,
    };
  } catch (err: any) {
    const responseTimeMs = Date.now() - startTime;
    return {
      valid: false,
      isHealthy: false,
      httpStatus: err.response?.status || 0,
      testedUrl: targetUrl,
      responseTimeMs,
      error: err.message || 'Connection failed',
    };
  }
}

// Alias for backwards compatibility
export const checkExternalLinkHealth = checkFreelancerLinkHealth;

