export type JobCategoryKey =
  | 'data_scraping'
  | 'data_entry_conversion'
  | 'content_writing'
  | 'translation'
  | 'transcription'
  | 'simple_coding'
  | 'image_processing'
  | 'seo_research'
  | 'pdf_doc_automation'
  | 'social_media_content';

export interface SampleJobPreset {
  id: string;
  title: string;
  description: string;
  budget: number;
  platform: 'Upwork' | 'RemoteOK' | 'Contra' | 'Freelancer' | 'Direct Client';
  clientLocation: string;
  tags: string[];
}

export interface JobCategorySpec {
  id: JobCategoryKey;
  category: string;
  examples: string;
  deliverables: string;
  deliverableFormats: string[];
  techNeeded: string;
  techStack: string[];
  icon: string; // FontAwesome icon class
  lucideIconName: string;
  badgeColor: string;
  accentGradient: string;
  typicalBudgetRange: { min: number; max: number };
  keywords: string[];
  sampleJobs: SampleJobPreset[];
}

export const SUPPORTED_JOB_CATEGORIES: Record<JobCategoryKey, JobCategorySpec> = {
  data_scraping: {
    id: 'data_scraping',
    category: 'Data scraping',
    examples: 'Scrape product prices, emails, listings, social media data',
    deliverables: 'CSV, JSON, Excel',
    deliverableFormats: ['.csv', '.json', '.xlsx'],
    techNeeded: 'Python, Scrapy, Puppeteer',
    techStack: ['Python', 'Scrapy', 'Puppeteer', 'Playwright', 'BeautifulSoup', 'httpx'],
    icon: 'fa-spider',
    lucideIconName: 'Database',
    badgeColor: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    accentGradient: 'from-emerald-600 to-teal-600',
    typicalBudgetRange: { min: 150, max: 800 },
    keywords: ['scrape', 'scraper', 'scraping', 'crawl', 'crawler', 'harvest', 'extract prices', 'extract emails', 'product listings', 'social media data', 'scrapy', 'puppeteer', 'beautifulsoup', 'playwright'],
    sampleJobs: [
      {
        id: 'job-scrape-1',
        title: 'E-commerce Competitor Price & Stock Scraper into CSV/JSON',
        description: 'Scrape 2,500 daily product prices, SKUs, inventory status, and discount badges across 3 competitor sites with anti-bot bypass and save to clean CSV & JSON.',
        budget: 450,
        platform: 'Upwork',
        clientLocation: 'United States',
        tags: ['Python', 'Scrapy', 'Puppeteer', 'CSV Export', 'Data Scraping']
      },
      {
        id: 'job-scrape-2',
        title: 'B2B Directory Email & Company Profile Harvester',
        description: 'Extract corporate emails, verified phone numbers, company URLs, and executive names from industrial supplier directories with rate-limiting.',
        budget: 320,
        platform: 'Contra',
        clientLocation: 'United Kingdom',
        tags: ['Web Scraping', 'Email List', 'Python', 'JSON']
      }
    ]
  },

  data_entry_conversion: {
    id: 'data_entry_conversion',
    category: 'Data entry & conversion',
    examples: 'PDF → Excel, image → text (OCR), CSV cleanup, merge files',
    deliverables: 'Excel, CSV, Word',
    deliverableFormats: ['.xlsx', '.csv', '.docx'],
    techNeeded: 'OCR, pandas, openpyxl',
    techStack: ['OCR (Tesseract/Vision)', 'pandas', 'openpyxl', 'python-docx', 'tabula-py'],
    icon: 'fa-file-excel',
    lucideIconName: 'FileSpreadsheet',
    badgeColor: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
    accentGradient: 'from-cyan-600 to-blue-600',
    typicalBudgetRange: { min: 80, max: 400 },
    keywords: ['data entry', 'pdf to excel', 'pdf to csv', 'image to text', 'ocr', 'csv cleanup', 'merge files', 'clean messy data', 'excel conversion', 'openpyxl', 'pandas', 'deduplication', 'normalize columns'],
    sampleJobs: [
      {
        id: 'job-entry-1',
        title: 'Financial Statement Scanned PDF to Formatted Excel Workbook',
        description: 'Convert 45 scanned monthly bank ledger PDFs into structured Excel sheets with formula audits, category tagging, and automatic total validation.',
        budget: 280,
        platform: 'Freelancer',
        clientLocation: 'Canada',
        tags: ['OCR', 'pandas', 'openpyxl', 'PDF to Excel', 'Data Cleaning']
      },
      {
        id: 'job-entry-2',
        title: 'Multi-Source CSV Dataset Normalization & Record Merging',
        description: 'Combine 12 mismatched customer CSV files, remove duplicate records, standardize telephone and state abbreviations, output single unified Excel table.',
        budget: 190,
        platform: 'RemoteOK',
        clientLocation: 'Australia',
        tags: ['pandas', 'Data Conversion', 'CSV Merge', 'Excel']
      }
    ]
  },

  content_writing: {
    id: 'content_writing',
    category: 'Content writing',
    examples: 'Blog posts, product descriptions, SEO articles, summaries',
    deliverables: 'Google Doc, Word, text',
    deliverableFormats: ['.docx', '.txt', '.md'],
    techNeeded: 'LLM (GPT, Claude)',
    techStack: ['Gemini 3.8 / LLM', 'Claude / GPT API', 'Markdown to DOCX', 'Grammar / Readability Engine'],
    icon: 'fa-pen-nib',
    lucideIconName: 'FileText',
    badgeColor: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
    accentGradient: 'from-purple-600 to-pink-600',
    typicalBudgetRange: { min: 100, max: 600 },
    keywords: ['content writing', 'blog post', 'article', 'product description', 'seo article', 'summary', 'copywriting', 'editorial', 'newsletter', 'whitepaper', 'technical writing', 'llm', 'gpt', 'claude'],
    sampleJobs: [
      {
        id: 'job-content-1',
        title: '2,500-word SEO Authority Guide on AI Workflow Automation',
        description: 'Write an in-depth, original, high-ranking SEO blog post targeting B2B CTOs with actionable benchmarks, FAQs, meta tags, and structured headers.',
        budget: 350,
        platform: 'Direct Client',
        clientLocation: 'United States',
        tags: ['SEO Article', 'Content Writing', 'Blog Post', 'Word / Doc']
      },
      {
        id: 'job-content-2',
        title: 'High-Converting Amazon & Shopify Product Descriptions Pack',
        description: 'Craft 20 persuasive, feature-to-benefit product descriptions with bullet points, emotional hooks, and SEO keyword placements.',
        budget: 220,
        platform: 'Contra',
        clientLocation: 'Germany',
        tags: ['Copywriting', 'Product Descriptions', 'E-commerce', 'Text Deliverable']
      }
    ]
  },

  translation: {
    id: 'translation',
    category: 'Translation',
    examples: 'Translate documents, subtitles, product listings',
    deliverables: 'Text, SRT',
    deliverableFormats: ['.txt', '.srt', '.json'],
    techNeeded: 'Translation API',
    techStack: ['DeepL / Google Neural Translation', 'Gemini Multilingual', 'SRT Parser', 'Glossary Alignment'],
    icon: 'fa-language',
    lucideIconName: 'Languages',
    badgeColor: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    accentGradient: 'from-amber-600 to-orange-600',
    typicalBudgetRange: { min: 120, max: 500 },
    keywords: ['translation', 'translate', 'subtitles', 'product listings translate', 'spanish translation', 'german translation', 'french translation', 'japanese', 'chinese', 'multilingual', 'srt translation', 'bilingual'],
    sampleJobs: [
      {
        id: 'job-trans-1',
        title: 'English to Spanish Technical Manual & User Guide Translation',
        description: 'Accurately translate a 12-page SaaS cloud infrastructure guide preserving terminology, formatting, and industry-standard technical phrasing.',
        budget: 310,
        platform: 'Upwork',
        clientLocation: 'Spain',
        tags: ['Translation', 'Spanish', 'Technical Documentation', 'Text Deliverable']
      },
      {
        id: 'job-trans-2',
        title: 'YouTube Video Series Subtitles Localization (English to German SRT)',
        description: 'Translate and time-sync 5 video subtitle SRT files ensuring character length limits per subtitle frame and colloquial natural dialogue.',
        budget: 240,
        platform: 'Freelancer',
        clientLocation: 'Germany',
        tags: ['SRT Subtitles', 'Video Translation', 'German', 'SRT Deliverable']
      }
    ]
  },

  transcription: {
    id: 'transcription',
    category: 'Transcription',
    examples: 'Audio/video → text, subtitles',
    deliverables: 'SRT, VTT, text',
    deliverableFormats: ['.srt', '.vtt', '.txt'],
    techNeeded: 'Whisper, speech-to-text',
    techStack: ['OpenAI Whisper', 'Google Cloud Speech-to-Text', 'PyDub / FFmpeg', 'Speaker Diarization'],
    icon: 'fa-headphones',
    lucideIconName: 'Mic',
    badgeColor: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
    accentGradient: 'from-rose-600 to-red-600',
    typicalBudgetRange: { min: 90, max: 450 },
    keywords: ['transcription', 'transcribe', 'audio to text', 'video to text', 'speech to text', 'subtitles', 'whisper', 'srt generation', 'vtt', 'podcast transcription', 'interview transcript', 'timestamped'],
    sampleJobs: [
      {
        id: 'job-audio-1',
        title: '60-Minute Executive Interview Audio Transcription with Speaker Labels',
        description: 'Generate 100% verbatim timestamped text and WebVTT caption tracks from recorded Zoom investor panel with clear speaker tags ([Speaker 1], [Speaker 2]).',
        budget: 180,
        platform: 'RemoteOK',
        clientLocation: 'United States',
        tags: ['Whisper', 'Audio to Text', 'SRT / VTT', 'Transcription']
      },
      {
        id: 'job-audio-2',
        title: 'Masterclass Video Course Subtitles Generation (SRT & Clean Transcript)',
        description: 'Process 8 educational video modules into professional SRT subtitles conforming to YouTube and Vimeo accessibility guidelines.',
        budget: 290,
        platform: 'Contra',
        clientLocation: 'Canada',
        tags: ['Speech-to-Text', 'SRT Deliverable', 'VTT Subtitles', 'Video']
      }
    ]
  },

  simple_coding: {
    id: 'simple_coding',
    category: 'Simple coding',
    examples: 'Python scripts, Excel macros, Google Sheets automation, bug fixes',
    deliverables: '.py, .js, .gs',
    deliverableFormats: ['.py', '.js', '.gs', '.bas'],
    techNeeded: 'Code generation + testing',
    techStack: ['Python', 'Google Apps Script (.gs)', 'VBA / Excel Macros', 'Node.js', 'pytest / Jest'],
    icon: 'fa-code',
    lucideIconName: 'Code',
    badgeColor: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    accentGradient: 'from-blue-600 to-indigo-600',
    typicalBudgetRange: { min: 120, max: 700 },
    keywords: ['python script', 'excel macro', 'google sheets automation', 'apps script', 'bug fix', 'macro', 'vba', 'automate task', 'small script', 'cron job', '.py', '.js', '.gs', 'webhook listener'],
    sampleJobs: [
      {
        id: 'job-code-1',
        title: 'Automated Google Sheets to Telegram Notification Webhook Script',
        description: 'Build a Google Apps Script (.gs) that listens for newly added customer rows and posts an instant formatted alert to a Telegram channel.',
        budget: 250,
        platform: 'Upwork',
        clientLocation: 'United States',
        tags: ['Google Apps Script', '.gs', 'Automation', 'Telegram API']
      },
      {
        id: 'job-code-2',
        title: 'Excel VBA Macro for Daily Sales Reconciliation & Audit Highlight',
        description: 'Write a robust VBA .bas macro script that validates invoices, highlights discrepancies in red, and exports a daily clean summary tab with one click.',
        budget: 200,
        platform: 'Freelancer',
        clientLocation: 'United Kingdom',
        tags: ['Excel Macro', 'VBA', 'Simple Coding', 'Automation']
      }
    ]
  },

  image_processing: {
    id: 'image_processing',
    category: 'Image processing',
    examples: 'Background removal, resize, watermark, format conversion',
    deliverables: 'PNG, JPG',
    deliverableFormats: ['.png', '.jpg', '.webp'],
    techNeeded: 'PIL, OpenCV, AI models',
    techStack: ['Python PIL / Pillow', 'OpenCV', 'rembg / AI Background Removal', 'ImageMagick'],
    icon: 'fa-image',
    lucideIconName: 'Image',
    badgeColor: 'border-pink-500/30 bg-pink-500/10 text-pink-300',
    accentGradient: 'from-pink-600 to-rose-600',
    typicalBudgetRange: { min: 100, max: 500 },
    keywords: ['image processing', 'background removal', 'remove background', 'resize images', 'batch resize', 'watermark', 'format conversion', 'png to jpg', 'webp conversion', 'opencv', 'pillow', 'pil', 'crop images'],
    sampleJobs: [
      {
        id: 'job-img-1',
        title: 'Batch Background Removal & Drop Shadow Pipeline for 500 Product Photos',
        description: 'Automate transparent PNG cutout generation, centered alignment, and white background replacement for an e-commerce catalog using PIL/OpenCV.',
        budget: 350,
        platform: 'Contra',
        clientLocation: 'Netherlands',
        tags: ['PIL', 'OpenCV', 'Background Removal', 'PNG / JPG']
      },
      {
        id: 'job-img-2',
        title: 'Dynamic Watermarking & Multi-Resolution Format Converter Script',
        description: 'Process raw high-res photographer uploads: add custom corner watermark, optimize webp/jpg compression, and generate thumbnail, preview, and print tiers.',
        budget: 210,
        platform: 'RemoteOK',
        clientLocation: 'United States',
        tags: ['Image Processing', 'Watermark', 'Pillow', 'Python']
      }
    ]
  },

  seo_research: {
    id: 'seo_research',
    category: 'SEO & research',
    examples: 'Keyword research, competitor analysis, lead lists',
    deliverables: 'Spreadsheet, report',
    deliverableFormats: ['.xlsx', '.csv', '.pdf', '.md'],
    techNeeded: 'APIs, LLM',
    techStack: ['Gemini / LLM Synthesis', 'Ahrefs/SEMrush Data APIs', 'Google SERP API', 'Spreadsheet Matrix Generator'],
    icon: 'fa-chart-line',
    lucideIconName: 'Search',
    badgeColor: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
    accentGradient: 'from-yellow-600 to-amber-600',
    typicalBudgetRange: { min: 150, max: 650 },
    keywords: ['seo', 'keyword research', 'competitor analysis', 'lead list', 'b2b leads', 'market research', 'serp analysis', 'content gap', 'search volume', 'spreadsheet report', 'lead enrichment'],
    sampleJobs: [
      {
        id: 'job-seo-1',
        title: 'B2B SaaS Competitor Organic Keyword Gap & Content Strategy Matrix',
        description: 'Analyze 4 top competitors in project management software, identify 150 high-intent low-difficulty keywords, and organize by cluster in a spreadsheet.',
        budget: 420,
        platform: 'Upwork',
        clientLocation: 'United States',
        tags: ['Keyword Research', 'Competitor Analysis', 'SEO', 'Spreadsheet']
      },
      {
        id: 'job-seo-2',
        title: 'Targeted Lead List of 500 E-Commerce Founders with Contact Points',
        description: 'Research and curate a verified B2B lead list of Shopify store owners generating $1M+ with name, title, domain, estimated tech stack, and company size.',
        budget: 330,
        platform: 'Contra',
        clientLocation: 'Australia',
        tags: ['Lead Lists', 'Market Research', 'CSV Report', 'Data Enrichment']
      }
    ]
  },

  pdf_doc_automation: {
    id: 'pdf_doc_automation',
    category: 'PDF & document automation',
    examples: 'Fill forms, generate invoices, extract tables',
    deliverables: 'PDF, Excel',
    deliverableFormats: ['.pdf', '.xlsx', '.csv'],
    techNeeded: 'PDF libraries',
    techStack: ['ReportLab', 'PDFKit / Puppeteer PDF', 'pdfplumber', 'pypdf', 'openpyxl'],
    icon: 'fa-file-pdf',
    lucideIconName: 'FileCheck',
    badgeColor: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
    accentGradient: 'from-orange-600 to-red-600',
    typicalBudgetRange: { min: 140, max: 600 },
    keywords: ['pdf automation', 'fill forms', 'generate invoices', 'extract tables', 'pdf to excel', 'pdf generator', 'reportlab', 'pdfkit', 'pdfplumber', 'invoice template', 'automated contract generation'],
    sampleJobs: [
      {
        id: 'job-pdf-1',
        title: 'Automated Invoice & Work Order PDF Generator with QR Code & Tax Math',
        description: 'Develop a Python script using ReportLab to dynamically inject billing line items, GST/VAT calculations, client addresses, and generate signed PDFs.',
        budget: 380,
        platform: 'Upwork',
        clientLocation: 'United Kingdom',
        tags: ['PDF Libraries', 'Invoice Generator', 'ReportLab', 'PDF Deliverable']
      },
      {
        id: 'job-pdf-2',
        title: 'Multi-Page Complex PDF Table Extractor to Clean Audited Excel',
        description: 'Extract intricate multi-column financial balance sheet tables from government PDF reports into structured, cell-aligned Excel workbooks.',
        budget: 270,
        platform: 'Freelancer',
        clientLocation: 'Canada',
        tags: ['PDF Table Extraction', 'Excel Deliverable', 'pdfplumber', 'Automation']
      }
    ]
  },

  social_media_content: {
    id: 'social_media_content',
    category: 'Social media content',
    examples: 'Generate posts, captions, hashtags, schedule via API',
    deliverables: 'Text, CSV',
    deliverableFormats: ['.csv', '.txt', '.json'],
    techNeeded: 'LLM + platform API',
    techStack: ['Gemini 3.8 / LLM', 'Meta Graph API', 'X (Twitter) API v2', 'Buffer / Hootsuite CSV Format', 'Hashtag Engine'],
    icon: 'fa-hashtag',
    lucideIconName: 'Share2',
    badgeColor: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
    accentGradient: 'from-teal-600 to-emerald-600',
    typicalBudgetRange: { min: 110, max: 550 },
    keywords: ['social media content', 'generate posts', 'captions', 'hashtags', 'schedule via api', 'linkedin posts', 'twitter thread', 'instagram captions', 'content calendar', 'meta graph api', 'social scheduler'],
    sampleJobs: [
      {
        id: 'job-social-1',
        title: '30-Day B2B Tech Thought Leadership Content Calendar for LinkedIn & X',
        description: 'Generate 30 high-engagement posts with provocative hooks, value carousels, call-to-actions, and niche hashtags formatted into an import-ready CSV schedule.',
        budget: 340,
        platform: 'Direct Client',
        clientLocation: 'United States',
        tags: ['Social Media', 'Content Calendar', 'CSV Schedule', 'LLM Posts']
      },
      {
        id: 'job-social-2',
        title: 'E-commerce Instagram Reel & TikTok Captions with Virality Hashtags',
        description: 'Create 15 engaging short-form video scripts, companion caption copy, product links, and targeted hashtag groups for seasonal fashion launch.',
        budget: 230,
        platform: 'Contra',
        clientLocation: 'United Kingdom',
        tags: ['Instagram Captions', 'Hashtags', 'Text Deliverable', 'Copywriting']
      }
    ]
  }
};

export const SUPPORTED_JOB_CATEGORIES_LIST = Object.values(SUPPORTED_JOB_CATEGORIES);

/**
 * Intelligently detect which of the 10 job categories applies to a given job listing
 */
export function detectJobCategory(
  title: string = '',
  description: string = '',
  tags: string[] = []
): JobCategorySpec {
  const combinedText = `${title} ${description} ${tags.join(' ')}`.toLowerCase();

  // Score each category based on matched keywords
  let highestScore = 0;
  let bestCategory: JobCategorySpec = SUPPORTED_JOB_CATEGORIES.simple_coding; // sensible default

  for (const cat of SUPPORTED_JOB_CATEGORIES_LIST) {
    let score = 0;
    // Direct category name check
    if (combinedText.includes(cat.category.toLowerCase())) {
      score += 5;
    }
    // Specific keywords
    for (const kw of cat.keywords) {
      if (combinedText.includes(kw.toLowerCase())) {
        score += 2;
      }
    }
    // Specific tech stack
    for (const tech of cat.techStack) {
      if (combinedText.includes(tech.toLowerCase())) {
        score += 3;
      }
    }

    if (score > highestScore) {
      highestScore = score;
      bestCategory = cat;
    }
  }

  return bestCategory;
}
