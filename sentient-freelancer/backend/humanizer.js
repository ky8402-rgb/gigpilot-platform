/**
 * SENTIENT FREELANCER — Seven-Dimension Humanizer & Indistinguishability Layer
 * Shared logic between Node.js backend and browser frontend.
 */

export const PROPOSAL_STYLES = {
  personalized_hook: {
    name: 'Personalized Hook',
    cost: 0.42,
    keywords: ['shopify', 'd2c', 'checkout', 'migration', 'ecommerce', 'store'],
    avgLen: 160
  },
  technical_deep_dive: {
    name: 'Technical Deep Dive',
    cost: 0.55,
    keywords: ['api', 'backend', 'infra', 'devops', 'data', 'architecture', 'database', 'node', 'python'],
    avgLen: 220
  },
  design_showcase: {
    name: 'Design Showcase',
    cost: 0.35,
    keywords: ['ui', 'ux', 'figma', 'mobile', 'frontend', 'tailwind', 'design', 'react'],
    avgLen: 140
  },
  quick_win: {
    name: 'Quick Win',
    cost: 0.22,
    keywords: ['bugfix', 'hotfix', 'urgent', 'small', 'quick', 'patch', 'error'],
    avgLen: 95
  },
  strategic_consult: {
    name: 'Strategic Consult',
    cost: 0.38,
    keywords: ['strategy', 'audit', 'review', 'architecture', 'consulting', 'roadmap'],
    avgLen: 180
  },
  no_bid: {
    name: 'No Bid',
    cost: 0.02,
    keywords: ['*'],
    avgLen: 0
  }
};

export const VOICES = {
  direct: {
    introTemplates: [
      "I saw your {metric} issue on {title} — here is the clean fix.",
      "Looked over your {title} scope; the friction is almost certainly in the {category} pipeline.",
      "Regarding {title}: your requirement for {metric} is straightforward if structured correctly.",
      "Quick one — I reviewed your brief for {title}."
    ],
    toneAdj: "concise and direct",
    signoff: "Best,\nAlex"
  },
  warm: {
    introTemplates: [
      "Hi there! Really enjoyed reading through your plans for {title}.",
      "Your goals for {title} immediately stood out, especially around {metric}.",
      "Hello! I've solved very similar puzzles for {category} projects recently.",
      "Hope you're having a great week. Your project ({title}) caught my attention."
    ],
    toneAdj: "collaborative, encouraging, and warm",
    signoff: "Cheers,\nAlex"
  },
  technical: {
    introTemplates: [
      "Audited your description for {title}: targeting {metric} requires specific concurrency boundaries.",
      "On {title}, the bottleneck in {category} typically stems from state synchronization.",
      "Technical note regarding {title}: standard implementations stumble on edge cases around {metric}.",
      "Deep dive on your spec: for {title}, I recommend structuring the data flow around decoupled events."
    ],
    toneAdj: "rigorous, architecture-first, and precise",
    signoff: "Regards,\nAlex — Staff Systems Engineer"
  },
  playful: {
    introTemplates: [
      "Spot on with {title}! Most teams overlook {metric} until prod catches fire.",
      "Finally a {category} project with clear requirements — {title} looks fun.",
      "I love untangling {metric} problems like the one you described in {title}.",
      "Quick heads-up: {title} doesn't need to be as painful as typical {category} setups make it."
    ],
    toneAdj: "energetic, witty, and confident",
    signoff: "Talk soon,\nAlex"
  },
  formal: {
    introTemplates: [
      "Dear Client, I am submitting this proposal for your engagement regarding {title}.",
      "In response to your posting for {title}, I offer proven expertise in enterprise {category}.",
      "I have reviewed the technical deliverables for {title}, with particular focus on {metric}.",
      "Please consider my candidacy for {title}; my background aligns with your quality standards."
    ],
    toneAdj: "measured, executive, and structured",
    signoff: "Sincerely,\nAlexander Wright"
  }
};

export const SHARP_QUESTIONS = [
  "Are you currently handling the fallback state on the client or queuing it upstream?",
  "What is your target latency or p99 SLA under peak user loads?",
  "Does your existing setup already have automated tests for this flow, or should I write them?",
  "Would you prefer an incremental migration or a clean zero-downtime cutover?",
  "Is there an existing staging environment with sanitized mock data ready for verification?"
];

export const SOFT_CTAS = [
  "Happy to hop on a 10-minute async loom or call whenever suits your schedule.",
  "Let me know if you'd like me to share a 3-minute architectural breakdown.",
  "If the timeline works, I can get the initial proof-of-concept running tomorrow morning.",
  "Feel free to reply here with any repo links or architecture docs if you'd like quick feedback."
];

/**
 * Box-Muller Gaussian Random Generator
 */
export function gauss(mean = 0, stdev = 1) {
  let u = 1 - Math.random();
  let v = Math.random();
  let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * stdev + mean;
}

/**
 * Log-Normal Sampling for Human Delays
 */
export function logNormalDelay(mu, sigma = 0.7, floorMs = 500, capMs = 25 * 60 * 1000) {
  const norm = gauss(0, 1);
  const val = Math.exp(mu + sigma * norm) * 1000;
  return Math.min(capMs, Math.max(floorMs, Math.round(val)));
}

/**
 * Generates or Rolls a Daily Freelancer Persona
 * Every day is distinct. Statistics shift plausibly like a living human.
 */
export function rollPersona(date = new Date(), prevPersona = null) {
  const dayOfWeek = date.getDay(); // 0 is Sunday, 6 is Saturday
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // Base schedule jitter ±90 min
  const baseStart = 9.0 + (gauss(0, 0.75)); // e.g. 8.25 to 9.75
  const baseEnd = 17.5 + (gauss(0, 0.75));
  const lunchHour = 12.75 + (gauss(0, 0.4));

  // Voice rotation (5 voices)
  const voiceKeys = ['direct', 'warm', 'technical', 'playful', 'formal'];
  const voiceSignature = voiceKeys[Math.floor(Math.random() * voiceKeys.length)];

  // Niche drift (evolves over time)
  const niches = [
    'Full-Stack Architecture & High-Scale APIs',
    'Shopify Plus & Headless D2C Infrastructure',
    'Distributed Cloud Systems & DevOps Resilience',
    'React Native & Cross-Platform Mobile Performance',
    'AI Integration & Automated Workflow Pipelines'
  ];
  const nicheIndex = Math.floor(date.getTime() / (30 * 24 * 60 * 60 * 1000)) % niches.length;
  const nicheDrift = niches[nicheIndex];

  // Length bias rotation
  const lengthBiases = ['short', 'medium', 'long'];
  const proposalLengthBias = lengthBiases[Math.floor(Math.random() * lengthBiases.length)];

  // Contradiction roll: 5% chance the persona breaks its own rules today!
  const hasContradiction = Math.random() < 0.05;
  let contradictionType = null;
  if (hasContradiction) {
    const types = ['late_night_proposal', 'long_lunch_break', 'burst_proposals', 'skipped_day', 'unusual_length'];
    contradictionType = types[Math.floor(Math.random() * types.length)];
  }

  const persona = {
    id: `persona_${date.toISOString().slice(0, 10)}_${Math.random().toString(36).substring(2, 7)}`,
    date: date.toISOString().slice(0, 10),
    workStart: Math.max(7.5, Math.min(10.5, Number(baseStart.toFixed(2)))),
    workEnd: Math.max(16.0, Math.min(21.0, Number(baseEnd.toFixed(2)))),
    lunchHour: Math.max(12.0, Math.min(14.0, Number(lunchHour.toFixed(2)))),
    sessionLengthTargetHours: Math.round(4 + Math.random() * 4), // 4–8 hr
    energyDecayPerHour: Number((0.08 + Math.random() * 0.14).toFixed(3)), // 0.08–0.22/hr
    browseSkipRatio: Number((0.60 + Math.random() * 0.22).toFixed(2)), // 0.60–0.82
    typoRate: Number((0.008 + Math.random() * 0.027).toFixed(3)), // 0.008–0.035
    proposalLengthBias,
    questionFrequency: Number((0.50 + Math.random() * 0.35).toFixed(2)), // 0.50–0.85
    ctaFrequency: Number((0.15 + Math.random() * 0.30).toFixed(2)), // 0.15–0.45
    responseLatencyBias: Math.random() > 0.5 ? 'fast' : 'deliberate',
    weekendMood: {
      satChance: Number((0.05 + Math.random() * 0.10).toFixed(2)),
      sunChance: Number((0.00 + Math.random() * 0.08).toFixed(2))
    },
    nicheDrift,
    voiceSignature,
    hasContradiction,
    contradictionType,
    vacationActive: false
  };

  return persona;
}

/**
 * Typo Injector (Imperfection Dimension):
 * Swaps two adjacent letters on words with length >= 6 with low probability
 */
export function injectTypo(text, typoRate = 0.02) {
  if (!text || Math.random() > typoRate) return text;
  const words = text.split(' ');
  const candidateIndices = [];
  words.forEach((w, i) => {
    if (w.length >= 6 && /^[a-zA-Z]+$/.test(w)) candidateIndices.push(i);
  });
  if (candidateIndices.length === 0) return text;

  const targetIdx = candidateIndices[Math.floor(Math.random() * candidateIndices.length)];
  const word = words[targetIdx];
  const swapPos = Math.floor(Math.random() * (word.length - 2)) + 1; // don't swap first letter
  const swapped = word.slice(0, swapPos) + word[swapPos + 1] + word[swapPos] + word.slice(swapPos + 2);
  words[targetIdx] = swapped;
  return words.join(' ');
}

/**
 * Human Proposal Synthesizer
 */
export function generateHumanProposal(job, styleKey, persona, history = []) {
  const style = PROPOSAL_STYLES[styleKey] || PROPOSAL_STYLES.personalized_hook;
  const voice = VOICES[persona.voiceSignature] || VOICES.direct;

  // Extract a metric or key noun from job
  const metric = job.budget ? `$${job.budget}` : 'zero-downtime performance';
  const category = job.category || 'application';

  // 1. First sentence
  const introIndex = Math.floor(Math.random() * voice.introTemplates.length);
  let intro = voice.introTemplates[introIndex]
    .replace('{title}', job.title || 'your project')
    .replace('{metric}', metric)
    .replace('{category}', category);

  // 2. Core technical value proposition
  let body = '';
  if (styleKey === 'personalized_hook') {
    body = `Looking closely at your stack, the primary objective is ensuring high reliability while eliminating technical debt. I have delivered similar integrations recently, resolving bottlenecks in ${category} workflows without impacting existing production data.`;
  } else if (styleKey === 'technical_deep_dive') {
    body = `Architecturally, this requires isolated modules with idempotent event delivery and rigorous error bounds. I suggest handling payload serialization and edge verification directly before running the core ${category} logic, preventing cascading timeout states.`;
  } else if (styleKey === 'design_showcase') {
    body = `User ergonomics and responsive contrast are critical here. I structure UI components cleanly in modular design tokens with fluid typography and accessible touch targets, keeping interactions snappy and intuitive.`;
  } else if (styleKey === 'quick_win') {
    body = `This is a focused fix. I will diagnose the failing path, isolate the root cause with regression tests, and deliver a clean PR ready for immediate review within a few hours.`;
  } else {
    body = `I approach this through a structured 3-phase audit: benchmark current baseline, establish non-breaking architectural guardrails, and implement the high-impact enhancements with automated monitoring.`;
  }

  // 3. Sharp question (probabilistic based on persona)
  let question = '';
  if (Math.random() < persona.questionFrequency) {
    question = SHARP_QUESTIONS[Math.floor(Math.random() * SHARP_QUESTIONS.length)];
  }

  // 4. Soft CTA (probabilistic based on persona)
  let cta = '';
  if (Math.random() < persona.ctaFrequency) {
    cta = SOFT_CTAS[Math.floor(Math.random() * SOFT_CTAS.length)];
  }

  // 5. Length adjustments based on persona proposalLengthBias
  let fullDraft = [intro, body, question, cta, voice.signoff].filter(Boolean).join('\n\n');

  if (persona.proposalLengthBias === 'short') {
    // 15% sentence trim
    fullDraft = [intro, body.split('. ')[0] + '.', question || cta, voice.signoff].filter(Boolean).join('\n\n');
  } else if (persona.proposalLengthBias === 'long') {
    // extra edit / detail
    const extraDetail = `My standard workflow includes comprehensive logging, clean git commits with semantic messages, and brief async documentation so your team can maintain this effortlessly.`;
    fullDraft = [intro, body, extraDetail, question, cta, voice.signoff].filter(Boolean).join('\n\n');
  }

  // 6. Occasional human imperfection (typo)
  fullDraft = injectTypo(fullDraft, persona.typoRate);

  return {
    text: fullDraft,
    style: styleKey,
    voice: persona.voiceSignature,
    wordCount: fullDraft.split(/\s+/).length,
    hook: intro
  };
}

/**
 * Anti-Fingerprinting Signature Guard
 * Ensures proposals comply with human limits.
 */
export function checkSignatureSafety(bodyState, proposedText, now = Date.now()) {
  const log = bodyState.signatureLog || [];
  const errors = [];

  // (a) Never send two proposals within 3 minutes (180,000 ms)
  const lastSend = log.length > 0 ? log[log.length - 1].timestamp : 0;
  if (lastSend && (now - lastSend < 3 * 60 * 1000)) {
    const waitSec = Math.ceil((3 * 60 * 1000 - (now - lastSend)) / 1000);
    errors.push(`Inter-proposal cooldown active: must wait at least ${waitSec}s (rule: min 3 min gap).`);
  }

  // (b) Never more than 3 in an hour
  const oneHourAgo = now - 60 * 60 * 1000;
  const recentHourly = log.filter(item => item.timestamp >= oneHourAgo);
  if (recentHourly.length >= 3) {
    errors.push(`Hourly safety throttle reached: max 3 proposals per hour (sent: ${recentHourly.length}).`);
  }

  // (c) Never more than 12 in a day
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const recentDaily = log.filter(item => item.timestamp >= oneDayAgo);
  if (recentDaily.length >= 12) {
    errors.push(`Daily human quota reached: max 12 proposals per 24 hours (sent: ${recentDaily.length}).`);
  }

  // (d) Never reuse the same opening line within 30 days
  const firstSentence = (proposedText.split(/[.\n]/)[0] || '').trim().toLowerCase();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const duplicateHook = log.find(item => item.timestamp >= thirtyDaysAgo && item.firstSentence === firstSentence);
  if (duplicateHook) {
    errors.push(`Opening line collision: duplicate opening detected from proposal sent ${new Date(duplicateHook.timestamp).toLocaleDateString()}.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    hourlyCount: recentHourly.length,
    dailyCount: recentDaily.length,
    nextAllowedSendTime: lastSend ? new Date(lastSend + 3 * 60 * 1000).toISOString() : new Date(now).toISOString()
  };
}
