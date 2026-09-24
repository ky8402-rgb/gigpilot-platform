/**
 * Hard Exclude Filters (Never Bid) Engine
 * 
 * Instantly skips any job matching forbidden keywords across:
 *  1. Physical / On-site
 *  2. Office / Hiring / Employment
 *  3. Human-dependent
 */

export interface HardExcludeCategory {
  id: 'physical_onsite' | 'office_hiring_employment' | 'human_dependent';
  name: string;
  description: string;
  keywords: string[];
}

export const HARD_EXCLUDE_CATEGORIES: Record<string, HardExcludeCategory> = {
  physical_onsite: {
    id: 'physical_onsite',
    name: 'Physical / On-site',
    description: 'Physical location, travel, or on-premises requirements',
    keywords: [
      'onsite',
      'on-site',
      'in-person',
      'local',
      'commute',
      'relocate',
      'warehouse',
      'delivery',
      'driving',
      'labor',
      'installation',
      'repair',
      'cleaning',
      'security',
      'physical',
      'office',
      'branch'
    ]
  },
  office_hiring_employment: {
    id: 'office_hiring_employment',
    name: 'Office / Hiring / Employment',
    description: 'W2/payroll/traditional employment or structured hour contracts',
    keywords: [
      'full-time',
      'part-time',
      'employee',
      'hiring',
      'job',
      'vacancy',
      'internship',
      'contract-to-hire',
      '9-5',
      'fixed hours',
      'salary',
      'payroll',
      'HR',
      'recruitment'
    ]
  },
  human_dependent: {
    id: 'human_dependent',
    name: 'Human-dependent',
    description: 'Real-time synchronous meetings, calls, managers, or legal gating',
    keywords: [
      'phone call',
      'video call',
      'Zoom',
      'meeting',
      'daily standup',
      'team',
      'manager',
      'interview',
      'NDA',
      'legal',
      'sign contract'
    ]
  }
};

export const ALL_HARD_EXCLUDE_KEYWORDS: string[] = [
  ...HARD_EXCLUDE_CATEGORIES.physical_onsite.keywords,
  ...HARD_EXCLUDE_CATEGORIES.office_hiring_employment.keywords,
  ...HARD_EXCLUDE_CATEGORIES.human_dependent.keywords
];

export interface HardExcludeCheckResult {
  shouldSkip: boolean;
  matchedKeyword?: string;
  category?: string;
  categoryId?: 'physical_onsite' | 'office_hiring_employment' | 'human_dependent';
  reason?: string;
  matchedTextSnippet?: string;
}

/**
 * Escapes regex special characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a robust regex pattern for a keyword or phrase:
 *  - Handles hyphen and space variations (e.g. "on-site" vs "on site", "full-time" vs "full time")
 *  - Handles "9-5" vs "9 to 5" vs "9 - 5"
 *  - Uses word boundary \b for single words (e.g. \bjob\b, \bhr\b, \bteam\b, \bnda\b)
 */
function buildKeywordRegex(keyword: string): RegExp {
  const lower = keyword.trim().toLowerCase();

  if (lower === '9-5') {
    return /\b(9\s*[-–—/]\s*5|9\s+to\s+5|9am\s*[-–—]\s*5pm)\b/i;
  }

  if (lower.includes('-')) {
    const parts = lower.split('-').map(escapeRegExp);
    return new RegExp(`\\b${parts[0]}[-\\s]+${parts[1]}\\b`, 'i');
  }

  if (lower.includes(' ')) {
    const parts = lower.split(/\s+/).map(escapeRegExp);
    return new RegExp(`\\b${parts.join('[-\\s]+')}\\b`, 'i');
  }

  return new RegExp(`\\b${escapeRegExp(lower)}\\b`, 'i');
}

// Precompile regex map for high performance
const COMPILED_KEYWORD_REGEX_MAP: Array<{
  keyword: string;
  category: HardExcludeCategory;
  regex: RegExp;
}> = [];

Object.values(HARD_EXCLUDE_CATEGORIES).forEach((category) => {
  category.keywords.forEach((keyword) => {
    COMPILED_KEYWORD_REGEX_MAP.push({
      keyword,
      category,
      regex: buildKeywordRegex(keyword)
    });
  });
});

/**
 * Evaluates whether a job or lead should be skipped by the Hard Exclude Filter
 */
export function checkHardExcludeFilter(
  target: string | {
    title?: string;
    description?: string;
    tags?: string[];
    skills?: string[];
    location?: string;
    category?: string;
    requirements?: string;
  }
): HardExcludeCheckResult {
  if (!target) {
    return { shouldSkip: false };
  }

  let textToInspect = '';
  if (typeof target === 'string') {
    textToInspect = target;
  } else {
    const pieces: string[] = [];
    if (target.title) pieces.push(target.title);
    if (target.description) pieces.push(target.description);
    if (Array.isArray(target.tags)) pieces.push(target.tags.join(' '));
    if (Array.isArray(target.skills)) pieces.push(target.skills.join(' '));
    if (target.location) pieces.push(target.location);
    if (target.category) pieces.push(target.category);
    if (target.requirements) pieces.push(target.requirements);
    textToInspect = pieces.join('\n');
  }

  if (!textToInspect.trim()) {
    return { shouldSkip: false };
  }

  for (const item of COMPILED_KEYWORD_REGEX_MAP) {
    const match = item.regex.exec(textToInspect);
    if (match) {
      const matchedSnippet = textToInspect.substring(
        Math.max(0, match.index - 25),
        Math.min(textToInspect.length, match.index + match[0].length + 25)
      );

      return {
        shouldSkip: true,
        matchedKeyword: item.keyword,
        category: item.category.name,
        categoryId: item.category.id,
        reason: `Instantly skipped: Contains forbidden keyword "${item.keyword}" (${item.category.name})`,
        matchedTextSnippet: `...${matchedSnippet.trim()}...`
      };
    }
  }

  return { shouldSkip: false };
}
