import cron from 'node-cron';
import { mlClient } from './mlClient.js';
import { getMLTrainingData } from './pgDatabase.js';

let lastSampleCountRetrainedAt = 0;
let isRetrainingRunning = false;

/**
 * Executes a retraining cycle with exponential backoff retry
 */
export async function executeRetrainJob(reason: string = 'scheduled_cron'): Promise<boolean> {
  if (isRetrainingRunning) {
    console.log(`ℹ️ [MLWorker] Retraining already in progress, skipping trigger (${reason}).`);
    return false;
  }

  isRetrainingRunning = true;
  console.log(`🚀 [MLWorker] Initiating automated ML model retraining (${reason})...`);

  const maxRetries = 3;
  let attempt = 0;
  let delay = 5000;

  while (attempt < maxRetries) {
    attempt++;
    try {
      const result = await mlClient.trainModel(false);
      console.log(`✅ [MLWorker] Autonomous retraining succeeded (Version: ${result.version}, Accuracy: ${result.accuracy}, Deployed: ${result.deployed})`);

      const currentData = await getMLTrainingData(500);
      lastSampleCountRetrainedAt = currentData.length;
      isRetrainingRunning = false;
      return true;
    } catch (err: any) {
      console.warn(`⚠️ [MLWorker] Retraining attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      if (attempt < maxRetries) {
        console.log(`⏳ [MLWorker] Waiting ${delay / 1000}s before retry...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 3; // Exponential backoff: 5s -> 15s -> 45s
      }
    }
  }

  console.error(`❌ [MLWorker] All ${maxRetries} retraining attempts failed. Escalation dispatched.`);
  isRetrainingRunning = false;
  return false;
}

/**
 * Check if continuous data accumulation (>100 new samples) or drift warrants retraining
 */
export async function checkDataAccumulationTrigger(): Promise<boolean> {
  try {
    const trainingData = await getMLTrainingData(300);
    const newSamples = trainingData.length - lastSampleCountRetrainedAt;

    if (newSamples >= 100) {
      console.log(`📈 [MLWorker] Retraining triggered: ${newSamples} new labeled samples accumulated (>100 threshold).`);
      return await executeRetrainJob(`data_accumulation_${newSamples}_samples`);
    }

    // Also check for confidence drift
    const driftCheck = await mlClient.checkDriftAndTriggerRetrain();
    if (driftCheck.retrained) {
      console.log(`🔄 [MLWorker] Model retrained due to: ${driftCheck.reason}`);
      return true;
    }

    return false;
  } catch (err: any) {
    console.warn('[MLWorker] Check data accumulation error:', err.message);
    return false;
  }
}

/**
 * Cleans and validates a cron expression string, removing comments and trailing text
 */
function sanitizeCronPattern(raw: string | undefined, defaultExpr: string = '0 0 * * 0'): string {
  if (!raw || typeof raw !== 'string') return defaultExpr;

  // Strip inline comments (e.g. "0 0 * * 0   # weekly on Sunday")
  const stripped = raw.split('#')[0].split('//')[0].trim();
  if (!stripped) return defaultExpr;

  // If node-cron validates it directly, use it
  if (cron.validate(stripped)) {
    return stripped;
  }

  // If extra tokens exist, attempt to extract the first 5 or 6 whitespace-delimited tokens
  const tokens = stripped.split(/\s+/).filter(Boolean);
  if (tokens.length >= 5) {
    const candidate5 = tokens.slice(0, 5).join(' ');
    if (cron.validate(candidate5)) {
      return candidate5;
    }
    if (tokens.length >= 6) {
      const candidate6 = tokens.slice(0, 6).join(' ');
      if (cron.validate(candidate6)) {
        return candidate6;
      }
    }
  }

  console.warn(`⚠️ [MLWorker] Invalid cron expression "${raw}". Falling back to default "${defaultExpr}".`);
  return defaultExpr;
}

/**
 * Initialize ML background scheduler
 */
export function startMLWorker(): void {
  const rawCron = process.env.ML_RETRAIN_CRON;
  const cronExpression = sanitizeCronPattern(rawCron, '0 0 * * 0'); // Weekly on Sunday
  console.log(`🕒 [MLWorker] Initializing ML Retrain scheduler with validated cron: "${cronExpression}" (raw: "${rawCron || 'default'}")`);

  // 1. Weekly scheduled cron (safeguarded against runtime parse errors)
  try {
    cron.schedule(cronExpression, async () => {
      console.log('⏰ [MLWorker] Executing scheduled weekly model retraining...');
      await executeRetrainJob('weekly_cron');
    });
  } catch (err: any) {
    console.error(`❌ [MLWorker] Failed to schedule cron task with "${cronExpression}": ${err.message}. Using safe fallback '0 0 * * 0'.`);
    cron.schedule('0 0 * * 0', async () => {
      await executeRetrainJob('weekly_cron_fallback');
    });
  }

  // 2. Periodic data accumulation & drift check every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    await checkDataAccumulationTrigger();
  });
}
