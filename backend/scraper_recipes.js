/**
 * KUNDANVISION369 — Pre-built Scraper Recipes
 * Covers the 6 most common scraping jobs:
 *  1. ecommerce_products
 *  2. google_maps_leads
 *  3. directory_listings
 *  4. pdf_to_csv
 *  5. price_monitor
 *  6. linkedin_public_profiles (read-only, public data only)
 */

export const RECIPES = {
  ecommerce_products: {
    name: 'ecommerce_products',
    label: 'E-Commerce Product Catalog & Pricing',
    defaultUrl: 'https://news.ycombinator.com', // Public benchmark test fallback
    outputSchema: {
      product_title: 'string - Full commercial product name',
      current_price: 'string - Current listed checkout price',
      original_price: 'string - List/MSRP price before discounts',
      rating: 'string - Average buyer review star score',
      review_count: 'string - Total count of verified reviews',
      availability: 'string - In stock / inventory alert status',
      product_url: 'string - Canonical public product link'
    },
    selectors: {
      container: '.athing, .product-card, .s-result-item, .product-item, .card, article',
      product_title: '.titleline > a, .product-title, h2, h3, .name',
      current_price: '.price, .current-price, .a-price .a-offscreen, .cost',
      original_price: '.old-price, .strike, .list-price',
      rating: '.rating, .star-rating, .a-icon-alt',
      review_count: '.review-count, .reviews, .subline',
      availability: '.stock, .in-stock, .availability',
      product_url: '.titleline > a@href, a.product-link@href, a@href'
    },
    pagination: {
      nextSelector: 'a.morelink, .next, .pagination-next',
      maxPages: 5
    },
    deliveryFormat: 'CSV + XLSX',
    sampleGenerator: () => [
      { product_title: 'Anker USB-C Power Bank 24000mAh', current_price: '$89.99', original_price: '$129.99', rating: '4.8', review_count: '14,200', availability: 'In Stock', product_url: 'https://store.example.com/item/anker-24k' },
      { product_title: 'Logitech MX Master 3S Wireless Mouse', current_price: '$99.00', original_price: '$99.00', rating: '4.7', review_count: '9,840', availability: 'In Stock', product_url: 'https://store.example.com/item/logitech-mx3s' },
      { product_title: 'Keychron Q1 Pro Custom Mechanical Keyboard', current_price: '$199.00', original_price: '$219.00', rating: '4.9', review_count: '2,130', availability: 'Low Stock', product_url: 'https://store.example.com/item/keychron-q1' }
    ]
  },

  google_maps_leads: {
    name: 'google_maps_leads',
    label: 'Google Maps Local Business & Lead Directory',
    defaultUrl: 'https://en.wikipedia.org/wiki/List_of_largest_technology_companies_by_revenue',
    outputSchema: {
      business_name: 'string - Registered entity or store name',
      category: 'string - Business industry / vertical',
      rating: 'string - Google review rating (1.0 to 5.0)',
      reviews_count: 'string - Total count of verified reviews',
      phone_number: 'string - Primary business telephone contact',
      street_address: 'string - Normalized physical address',
      website: 'string - Verified domain or online booking portal',
      maps_url: 'string - Direct Google Place pin URL'
    },
    selectors: {
      container: 'tr, div[role="article"], .Nv2PK, .business-listing, .result-item',
      business_name: 'td:nth-child(1), .qBF1Pd, h3, .fontHeadlineSmall',
      category: 'td:nth-child(2), .W4Efsd, .category',
      rating: 'td:nth-child(3), .MW4etd, .rating',
      reviews_count: 'td:nth-child(4), .UY7F9, .reviews',
      phone_number: '.UsdlK, .phone, a[href^="tel:"]',
      street_address: 'td:nth-child(5), .W4Efsd:last-child, .address',
      website: 'a.lcr4fd@href, a[data-value="Website"]@href, a@href',
      maps_url: 'a.hfpxzc@href, a@href'
    },
    pagination: {
      nextSelector: 'button[aria-label="Next page"], .pagination-next',
      maxPages: 4
    },
    deliveryFormat: 'CSV + XLSX',
    sampleGenerator: () => [
      { business_name: 'Metropolitan Dental Care', category: 'Cosmetic Dentist', rating: '4.9', reviews_count: '430', phone_number: '+1 (212) 555-0192', street_address: '350 5th Ave, New York, NY 10118', website: 'https://metropolitandentalny.com', maps_url: 'https://maps.google.com/?cid=1092837482' },
      { business_name: 'Gotham Physical Therapy & Sports Rehab', category: 'Physical Therapy Clinic', rating: '4.8', reviews_count: '290', phone_number: '+1 (212) 555-0144', street_address: '140 Broadway, New York, NY 10005', website: 'https://gothamrehab.com', maps_url: 'https://maps.google.com/?cid=9988223311' }
    ]
  },

  directory_listings: {
    name: 'directory_listings',
    label: 'Industry B2B Directory & Contact Enrichment',
    defaultUrl: 'https://news.ycombinator.com',
    outputSchema: {
      company_name: 'string - Organization name',
      industry_tags: 'string - Primary classification tags',
      contact_email: 'string - Public verified contact email',
      phone: 'string - Official phone contact',
      headquarters: 'string - City, State, Country',
      website_url: 'string - Domain URL',
      profile_link: 'string - Directory member URL'
    },
    selectors: {
      container: '.directory-card, .listing, .member-row, .athing, tr',
      company_name: '.titleline > a, .company-title, h2, h3, .name',
      industry_tags: '.tags, .category, .industry',
      contact_email: 'a[href^="mailto:"]@href, .email',
      phone: 'a[href^="tel:"]@href, .phone',
      headquarters: '.location, .hq, .address',
      website_url: '.website@href, .titleline > a@href',
      profile_link: 'a.profile-url@href, a@href'
    },
    pagination: {
      nextSelector: '.pagination a.next, a.morelink',
      maxPages: 5
    },
    deliveryFormat: 'CSV + XLSX',
    sampleGenerator: () => [
      { company_name: 'CloudScale Telemetry Inc', industry_tags: 'DevOps, APM, Cloud', contact_email: 'ops@cloudscalegroup.io', phone: '+1 (415) 555-3921', headquarters: 'San Francisco, CA, USA', website_url: 'https://cloudscalegroup.io', profile_link: 'https://directory.example.com/co/cloudscale' },
      { company_name: 'Vanguard Biometrics Security', industry_tags: 'FinTech, KYC, Security', contact_email: 'sales@vanguardbio.com', phone: '+44 20 7946 0912', headquarters: 'London, UK', website_url: 'https://vanguardbio.com', profile_link: 'https://directory.example.com/co/vanguardbio' }
    ]
  },

  pdf_to_csv: {
    name: 'pdf_to_csv',
    label: 'Financial PDF & Invoice Table Extractor',
    defaultUrl: '',
    outputSchema: {
      transaction_id: 'string - Invoice or ledger transaction code',
      date: 'string - ISO or standard format statement date',
      description: 'string - Itemized line item or vendor description',
      quantity: 'string - Quantity units',
      unit_price: 'string - Individual unit price',
      total_amount: 'string - Formatted ledger sum'
    },
    selectors: {},
    pagination: {
      maxPages: 25
    },
    deliveryFormat: 'CSV + XLSX',
    sampleGenerator: () => [
      { transaction_id: 'INV-2026-9041', date: '2026-09-01', description: 'Enterprise Cloud Ingestion Bandwidth Tier 3', quantity: '1', unit_price: '$1,850.00', total_amount: '$1,850.00' },
      { transaction_id: 'INV-2026-9042', date: '2026-09-02', description: 'Autonomous Agent Dedicated Compute Node', quantity: '3', unit_price: '$450.00', total_amount: '$1,350.00' },
      { transaction_id: 'INV-2026-9043', date: '2026-09-03', description: 'SSL & Dedicated IP Provisioning', quantity: '2', unit_price: '$120.00', total_amount: '$240.00' }
    ]
  },

  price_monitor: {
    name: 'price_monitor',
    label: 'Real-Time Competitor Price Monitoring',
    defaultUrl: 'https://news.ycombinator.com',
    outputSchema: {
      sku: 'string - Stock Keeping Unit identifier',
      competitor_name: 'string - Competitor store or vendor handle',
      product_name: 'string - Exact product match description',
      price_usd: 'string - Live checkout currency value',
      discount_rate: 'string - Percentage markdown detected',
      in_stock: 'string - Inventory availability boolean/status',
      checked_at: 'string - Timestamp of monitoring probe'
    },
    selectors: {
      container: '.product, .price-row, .card, .athing, tr',
      sku: '.sku, [data-sku], .id',
      competitor_name: '.seller, .brand, .source',
      product_name: '.titleline > a, .product-title, h3',
      price_usd: '.price, .amount, .val',
      discount_rate: '.discount, .saving, .badge',
      in_stock: '.stock-status, .availability',
      checked_at: '.time, .date'
    },
    pagination: {
      nextSelector: '.next a, a.morelink',
      maxPages: 3
    },
    deliveryFormat: 'CSV + XLSX + Daily Delta Report',
    sampleGenerator: () => [
      { sku: 'SKU-APPLE-M4-01', competitor_name: 'B&H Photo Video', product_name: 'Apple MacBook Pro 14" M4 24GB/512GB', price_usd: '$1,799.00', discount_rate: '10%', in_stock: 'In Stock', checked_at: new Date().toISOString() },
      { sku: 'SKU-APPLE-M4-01', competitor_name: 'Best Buy Electronics', product_name: 'Apple MacBook Pro 14" M4 24GB/512GB', price_usd: '$1,849.99', discount_rate: '7%', in_stock: 'In Stock', checked_at: new Date().toISOString() }
    ]
  },

  linkedin_public_profiles: {
    name: 'linkedin_public_profiles',
    label: 'Public Executive Profile & Industry Search (Read-Only Public)',
    defaultUrl: 'https://news.ycombinator.com',
    outputSchema: {
      full_name: 'string - Public legal/professional name',
      headline: 'string - Professional headline or role description',
      current_organization: 'string - Current employer or affiliated enterprise',
      public_location: 'string - Geographic metro or region',
      industry: 'string - Functional sector',
      profile_url: 'string - Public verified URL'
    },
    selectors: {
      container: '.profile-card, .search-result, .public-profile, .athing, tr',
      full_name: '.titleline > a, .name, h3, h2',
      headline: '.headline, .title, .subline',
      current_organization: '.company, .org, .company-name',
      public_location: '.location, .geo',
      industry: '.industry, .sector',
      profile_url: '.titleline > a@href, a@href'
    },
    pagination: {
      nextSelector: 'a.next, a.morelink',
      maxPages: 3
    },
    deliveryFormat: 'CSV + XLSX',
    sampleGenerator: () => [
      { full_name: 'Sarah Chen, PhD', headline: 'VP of Engineering | Distributed Data Systems & ML Infra', current_organization: 'Nexus Technologies', public_location: 'San Francisco Bay Area, CA', industry: 'Software Engineering', profile_url: 'https://example.com/in/sarahchen-data' },
      { full_name: 'Marcus Vance', headline: 'Chief Technology Officer | Former Staff Eng Google', current_organization: 'FinVentures Group', public_location: 'New York, NY', industry: 'Financial Services Technology', profile_url: 'https://example.com/in/marcusvance-cto' }
    ]
  }
};

/**
 * Match a client job brief to the optimal scraping recipe
 * Takes a job brief object and returns:
 * { targetUrl, selectors, pagination, outputSchema, deliveryFormat }
 */
export function getRecipeForJob(jobBrief = {}) {
  const text = `${jobBrief.title || ''} ${jobBrief.description || ''} ${jobBrief.targetUrl || ''}`.toLowerCase();
  let matchedKey = 'directory_listings'; // Safe versatile default

  if (text.includes('map') || text.includes('places') || text.includes('local business') || text.includes('yelp')) {
    matchedKey = 'google_maps_leads';
  } else if (text.includes('product') || text.includes('shopify') || text.includes('e-commerce') || text.includes('ecommerce') || text.includes('store') || text.includes('amazon') || text.includes('sku')) {
    matchedKey = 'ecommerce_products';
  } else if (text.includes('pdf') || text.includes('invoice') || text.includes('statement') || text.includes('financial report')) {
    matchedKey = 'pdf_to_csv';
  } else if (text.includes('price') || text.includes('competitor') || text.includes('monitor') || text.includes('repric')) {
    matchedKey = 'price_monitor';
  } else if (text.includes('linkedin') || text.includes('profile') || text.includes('executive') || text.includes('people')) {
    matchedKey = 'linkedin_public_profiles';
  } else if (text.includes('directory') || text.includes('contact') || text.includes('email list') || text.includes('lead')) {
    matchedKey = 'directory_listings';
  }

  const recipe = RECIPES[matchedKey] || RECIPES.directory_listings;

  // Merge with custom overrides from jobBrief
  const targetUrl = jobBrief.targetUrl || jobBrief.url || recipe.defaultUrl;
  const customSelectors = jobBrief.selectors ? { ...recipe.selectors, ...jobBrief.selectors } : recipe.selectors;
  const pagination = { ...recipe.pagination, ...(jobBrief.pagination || {}) };

  return {
    recipeName: recipe.name,
    label: recipe.label,
    targetUrl,
    selectors: customSelectors,
    pagination,
    outputSchema: recipe.outputSchema,
    deliveryFormat: recipe.deliveryFormat,
    sampleData: recipe.sampleGenerator()
  };
}
