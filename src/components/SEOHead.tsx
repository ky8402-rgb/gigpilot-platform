import React, { useEffect } from 'react';

export interface SEOHeadProps {
  title?: string;
  description?: string;
  keywords?: string[];
  canonicalUrl?: string;
  ogImage?: string;
  ogType?: 'website' | 'article' | 'profile';
  author?: string;
  activeSection?: string;
}

export const DEFAULT_OG_IMAGE = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1200&auto=format&fit=crop';

export const SEOHead: React.FC<SEOHeadProps> = ({
  title = 'kundanvision369 · AI Freelance Autopilot & Payment Gateway',
  description = 'Real-time autonomous work orders, Gemini AI proposal studio, RemoteOK live gig aggregator, instant PayPal gateway, and Indian Bank IMPS/UPI settlements.',
  keywords = [
    'kundanvision369',
    'AI Freelance Autopilot',
    'RemoteOK Jobs',
    'PayPal Payment Gateway',
    'Indian Bank IMPS Settlements',
    'UPI QR Payments',
    'Freelance Proposal Studio',
    'Automated Invoicing',
    'Gemini AI Assistant'
  ],
  canonicalUrl = typeof window !== 'undefined' ? window.location.href : 'https://kundanvision369.onrender.com',
  ogImage = DEFAULT_OG_IMAGE,
  ogType = 'website',
  author = 'Kundan Kumar (ky8402@gmail.com)',
  activeSection,
}) => {
  const fullTitle = activeSection 
    ? `${activeSection} | kundanvision369 · AI Freelance Autopilot`
    : title;

  const currentUrl = typeof window !== 'undefined' ? window.location.origin + window.location.pathname : canonicalUrl;

  // Sync title and meta tags directly with DOM for robust compatibility
  useEffect(() => {
    document.title = fullTitle;

    const setMeta = (name: string, content: string, isProperty = false) => {
      const attr = isProperty ? 'property' : 'name';
      let el = document.querySelector(`meta[${attr}="${name}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };

    setMeta('description', description);
    setMeta('keywords', keywords.join(', '));
    setMeta('author', author);
    setMeta('og:title', fullTitle, true);
    setMeta('og:description', description, true);
    setMeta('og:type', ogType, true);
    setMeta('og:url', currentUrl, true);
    setMeta('og:image', ogImage, true);
    setMeta('twitter:title', fullTitle);
    setMeta('twitter:description', description);
    setMeta('twitter:image', ogImage);

    // Schema.org script
    let scriptEl = document.getElementById('seo-structured-data') as HTMLScriptElement | null;
    if (!scriptEl) {
      scriptEl = document.createElement('script');
      scriptEl.id = 'seo-structured-data';
      scriptEl.type = 'application/ld+json';
      document.head.appendChild(scriptEl);
    }
    scriptEl.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      'name': 'kundanvision369',
      'url': currentUrl,
      'description': description,
      'applicationCategory': 'BusinessApplication',
      'operatingSystem': 'All',
      'browserRequirements': 'Requires JavaScript. Requires HTML5.',
      'author': {
        '@type': 'Person',
        'name': 'Kundan Kumar',
        'email': 'ky8402@gmail.com'
      },
      'offers': {
        '@type': 'Offer',
        'price': '0',
        'priceCurrency': 'USD'
      },
      'featureList': [
        'Autonomous Freelance Work Order Tracking',
        'Live RemoteOK Aggregated Gig Scanner',
        'PayPal Instant Checkout & Virtual Terminal',
        'Indian Bank IMPS, NEFT & Dynamic UPI QR Engine',
        'Google Gemini AI Powered Proposal Generator'
      ]
    });
  }, [fullTitle, description, keywords, author, ogType, currentUrl, ogImage]);

  return null;
};

export default SEOHead;

