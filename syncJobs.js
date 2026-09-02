import axios from 'axios';
import pg from 'pg';

const { Pool } = pg;

// Initialize PostgreSQL Connection Pool using DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/freelance_db',
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : undefined
});

/**
 * Ensures the work_orders table exists with a unique constraint on url
 */
async function ensureWorkOrdersTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS work_orders (
        id SERIAL PRIMARY KEY,
        title TEXT,
        company TEXT,
        category TEXT,
        url TEXT UNIQUE,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
  } catch (err) {
    console.warn("Table verification notice:", err.message);
  }
}

/**
 * FETCHES LIVE WORK ORDERS FROM WE WORK REMOTELY (FREE PUBLIC FEED)
 * AND SAVES THEM DIRECTLY TO YOUR POSTGRESQL DATABASE
 */
export async function syncWeWorkRemotelyJobs() {
  try {
    console.log("Fetching live jobs from We Work Remotely...");

    await ensureWorkOrdersTable();

    // WWR provides public feeds/API for remote work listings
    const response = await axios.get('https://weworkremotely.com/categories/remote-programming-jobs.rss', {
      headers: {
        'Accept': 'application/json, text/xml, application/xml, */*',
        'User-Agent': 'Mozilla/5.0 (compatible; JobSync/1.0)'
      },
      timeout: 10000
    }).catch(async () => {
      // Fallback endpoint
      return await axios.get('https://weworkremotely.com/remote-jobs.rss', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      });
    });

    let jobs = [];

    // Check if JSON response directly provided or parse items
    if (response.data && response.data.jobs && Array.isArray(response.data.jobs)) {
      jobs = response.data.jobs;
    } else if (typeof response.data === 'string' && response.data.includes('<item>')) {
      // Parse RSS XML items simply
      const items = response.data.split('<item>').slice(1);
      jobs = items.map((item) => {
        const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/) || item.match(/<guid[^>]*>(.*?)<\/guid>/);
        const descMatch = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || item.match(/<description>([\s\S]*?)<\/description>/);
        const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
        const rawTitle = titleMatch ? titleMatch[1].trim() : 'Remote Software Developer';
        
        let company = 'WeWorkRemotely Client';
        let title = rawTitle;
        if (rawTitle.includes(':')) {
          const parts = rawTitle.split(':');
          company = parts[0].trim();
          title = parts.slice(1).join(':').trim();
        }

        return {
          title,
          company,
          category: 'Software Engineering & Remote Dev',
          url: linkMatch ? linkMatch[1].trim() : `https://weworkremotely.com/jobs/${Date.now()}-${Math.random()}`,
          description: descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ').slice(0, 1000).trim() : 'Live remote work order from We Work Remotely.',
          created_at: pubDateMatch ? new Date(pubDateMatch[1]) : new Date()
        };
      });
    }

    if (!jobs || jobs.length === 0) {
      console.log("No jobs found in current feed batch.");
      return;
    }

    console.log(`Found ${jobs.length} live jobs. Syncing with database...`);

    // Loop through each job and insert/update it in your PostgreSQL database
    let insertedCount = 0;
    for (const job of jobs) {
      const query = `
        INSERT INTO work_orders (title, company, category, url, description, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (url) DO UPDATE 
        SET title = EXCLUDED.title, description = EXCLUDED.description;
      `;

      const values = [
        job.title || 'Remote Work Order',
        job.company || 'Remote Client',
        job.category || 'Engineering',
        job.url, // Unique identifier to prevent duplicate entries
        job.description || '',
        job.created_at ? new Date(job.created_at) : new Date()
      ];

      await pool.query(query, values);
      insertedCount++;
    }

    console.log(`Database sync completed successfully! Synced ${insertedCount} work orders.`);
  } catch (error) {
    console.error("Error syncing jobs from We Work Remotely:", error.message);
  }
}

// Auto-run if executed directly via CLI
if (process.argv[1] && process.argv[1].endsWith('syncJobs.js')) {
  syncWeWorkRemotelyJobs()
    .then(() => {
      console.log("Sync finished.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Sync process failed:", err);
      process.exit(1);
    });
}
