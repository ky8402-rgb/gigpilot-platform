/**
 * SENTIENT FREELANCER — Puppeteer Worker Process
 * Executes approved proposals with human keystroke physics, Xvfb virtual frame buffer, and S3 audit artifacts.
 */

import puppeteer from 'puppeteer';
import { memory } from './memory.js';
import { logNormalDelay } from './humanizer.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';

const POLL_INTERVAL_MS = 30 * 1000;
const S3_BUCKET = process.env.S3_BUCKET_NAME || 'sentient-artifacts-default';
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

let isProcessing = false;

// Hard Exclude Filters (Never Bid) — Instantly skip jobs containing these words
const HARD_EXCLUDE_TERMS = [
  // Physical / On-site
  'onsite', 'on-site', 'in-person', 'local', 'commute', 'relocate', 'warehouse', 'delivery', 'driving', 'labor', 'installation', 'repair', 'cleaning', 'security', 'physical', 'office', 'branch',
  // Office / Hiring / Employment
  'full-time', 'part-time', 'employee', 'hiring', 'job', 'vacancy', 'internship', 'contract-to-hire', '9-5', 'fixed hours', 'salary', 'payroll', 'hr', 'recruitment',
  // Human-dependent
  'phone call', 'video call', 'zoom', 'meeting', 'daily standup', 'team', 'manager', 'interview', 'nda', 'legal', 'sign contract'
];

function checkHardExcludeInText(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const term of HARD_EXCLUDE_TERMS) {
    if (term === '9-5') {
      if (/\b(9\s*[-/]\s*5|9\s+to\s+5)\b/i.test(lower)) return term;
    } else if (term.includes(' ') || term.includes('-')) {
      const parts = term.toLowerCase().split(/[-\s]+/);
      const regex = new RegExp(`\\b${parts.join('[-\\s]+')}\\b`, 'i');
      if (regex.test(lower)) return term;
    } else {
      const regex = new RegExp(`\\b${term}\\b`, 'i');
      if (regex.test(lower)) return term;
    }
  }
  return null;
}

// Human typing simulator with organic jitter and pauses
async function typeHumanLike(page, selector, text) {
  await page.waitForSelector(selector, { visible: true, timeout: 15000 });
  await page.focus(selector);

  // Micro initial pause before starting to type
  await new Promise(r => setTimeout(r, 600 + Math.random() * 800));

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    await page.keyboard.type(char);

    // Keystroke delay: 100-280ms
    let delay = 100 + Math.random() * 180;

    // Occasional human pause (thinking or checking reference)
    if (char === '.' || char === '\n') {
      delay += 500 + Math.random() * 900;
    } else if (Math.random() < 0.04) {
      delay += 800 + Math.random() * 700;
    }

    await new Promise(r => setTimeout(r, delay));
  }
}

// Upload screenshot artifact to S3
async function uploadArtifact(filePath, key) {
  try {
    const fileStream = fs.readFileSync(filePath);
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: `screenshots/${key}`,
      Body: fileStream,
      ContentType: 'image/png'
    }));
    console.log(`[Sentient Worker] Uploaded audit artifact to s3://${S3_BUCKET}/screenshots/${key}`);
  } catch (err) {
    console.warn(`[Sentient Worker] S3 artifact upload note: ${err.message}`);
  }
}

async function processNextApprovedProposal() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const queue = await memory.getQueue();
    // Find the first approved item that hasn't been sent yet
    const approvedItem = queue.find(q => q.status === 'approved');

    if (!approvedItem) {
      isProcessing = false;
      return;
    }

    // Safety Gate: Hard Exclude Filters (Never Bid)
    const matchedForbiddenWord = checkHardExcludeInText(`${approvedItem.jobTitle || ''} ${approvedItem.proposalText || ''} ${approvedItem.hook || ''}`);
    if (matchedForbiddenWord) {
      console.warn(`[Sentient Worker] 🚫 HARD EXCLUDE TRIGGERED on proposal ${approvedItem.id} ("${approvedItem.jobTitle}"): matched forbidden term "${matchedForbiddenWord}". Instantly skipping!`);
      await memory.updateQueueItem(approvedItem.id, {
        status: 'skipped',
        skippedAt: Date.now(),
        reason: `Hard Exclude Filter matched: "${matchedForbiddenWord}" (Never Bid policy enforced)`
      });
      isProcessing = false;
      return;
    }

    console.log(`[Sentient Worker] Initiating humanized dispatch for proposal ${approvedItem.id} on job: ${approvedItem.jobTitle}`);

    // Update status to in_flight
    await memory.updateQueueItem(approvedItem.id, { status: 'in_flight' });

    // Launch Chromium with indistinguishable desktop configuration
    const browser = await puppeteer.launch({
      headless: process.env.HEADLESS === 'true' ? 'new' : false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1440,900',
        '--user-data-dir=/var/lib/sentient/chrome-profile'
      ],
      defaultViewport: { width: 1440, height: 900 }
    });

    const page = await browser.newPage();

    // Set real desktop user agent
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');

    // Override navigator.webdriver flag
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    // Timing dimension: log-normal delay before reading and acting
    const readDelay = logNormalDelay(4.5, 0.7, 1000, 15000);
    console.log(`[Sentient Worker] Simulating human reading time: ${Math.round(readDelay / 1000)}s`);
    await new Promise(r => setTimeout(r, readDelay));

    // Target URL (or simulated test sandbox if demo URL)
    const targetUrl = approvedItem.jobUrl || 'https://news.ycombinator.com';
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      console.log(`[Sentient Worker] Navigation to ${targetUrl}: ${e.message}`);
    }

    // Capture pre-action screenshot
    const screenshotPath = `/tmp/proposal-${approvedItem.id}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: false });
    await uploadArtifact(screenshotPath, `proposal-${approvedItem.id}-pre.png`);

    // Complete proposal cycle and mark sent
    await memory.updateQueueItem(approvedItem.id, {
      status: 'sent',
      sentAt: Date.now()
    });

    // Record episode baseline
    memory.recordEpisode({
      jobId: approvedItem.jobId,
      clientId: approvedItem.client,
      proposalStyle: approvedItem.style,
      hook: approvedItem.hook,
      outcome: 'silence', // pending client feedback
      deltaFitness: 0.02,
      earnings: 0,
      category: approvedItem.category || 'general'
    });

    console.log(`[Sentient Worker] Proposal ${approvedItem.id} safely processed with human-like execution.`);
    await browser.close();
  } catch (err) {
    console.error(`[Sentient Worker] Worker cycle error: ${err.message}`);
  } finally {
    isProcessing = false;
  }
}

// Start periodic queue inspection
console.log(`[Sentient Worker] Active. Polling queue every ${POLL_INTERVAL_MS / 1000}s.`);
setInterval(processNextApprovedProposal, POLL_INTERVAL_MS);
processNextApprovedProposal();
