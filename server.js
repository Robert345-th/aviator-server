const http = require('http');
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');

const PASSWORD = 'R0978012009';
const TIMEOUT_MS = 30000;

// In-memory tabs (these don't need to persist)
let tabs = {};

// Connect to PostgreSQL
const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function initDB() {
  await db.connect();
  await db.query(`
    CREATE TABLE IF NOT EXISTS totals (
      site TEXT PRIMARY KEY,
      today NUMERIC DEFAULT 0,
      this_week NUMERIC DEFAULT 0,
      last_week NUMERIC DEFAULT 0,
      this_month NUMERIC DEFAULT 0,
      last_month NUMERIC DEFAULT 0,
      last_day_date TEXT DEFAULT '',
      last_week_date TEXT DEFAULT '',
      last_month_str TEXT DEFAULT ''
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS cashouts (
      id SERIAL PRIMARY KEY,
      tab_id TEXT,
      amount NUMERIC,
      timestamp BIGINT,
      site TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Insert default rows if not exist
  await db.query(`INSERT INTO totals (site) VALUES ('mwos') ON CONFLICT DO NOTHING`);
  await db.query(`INSERT INTO totals (site) VALUES ('bolabet') ON CONFLICT DO NOTHING`);
  console.log('Database ready!');
}

function getSite(site) {
  return site === 'bolabet' ? 'bolabet' : 'mwos';
}

async function checkReset(site) {
  const now = new Date();
  const dateStr = now.toDateString();
  const monthStr = `${now.getFullYear()}-${now.getMonth()}`;

  const res = await db.query('SELECT * FROM totals WHERE site = $1', [site]);
  const row = res.rows[0];

  let updates = {};

  // Midnight daily reset
  if (row.last_day_date !== '' && row.last_day_date !== dateStr) {
    updates.this_week = parseFloat(row.this_week) + parseFloat(row.today);
    updates.this_month = parseFloat(row.this_month) + parseFloat(row.today);
    updates.today = 0;
    console.log(`[RESET] Daily reset for ${site}`);
  }
  if (row.last_day_date !== dateStr) updates.last_day_date = dateStr;

  // Monthly reset on 1st
  if (now.getDate() === 1 && row.last_month_str !== monthStr) {
    updates.last_month = updates.this_month || row.this_month;
    updates.this_month = 0;
    updates.last_month_str = monthStr;
  }
  if (row.last_month_str === '') updates.last_month_str = monthStr;

  // Weekly reset on Saturday
  if (now.getDay() === 6 && row.last_week_date !== dateStr) {
    const weekTotal = (updates.this_week || parseFloat(row.this_week)) + (updates.today !== undefined ? updates.today : parseFloat(row.today));
    updates.last_week = weekTotal;
    updates.this_week = 0;
    updates.last_week_date = dateStr;
  }

  if (Object.keys(updates).length > 0) {
    const cols = Object.keys(updates).map((k, i) => `${k} = $${i+2}`).join(', ');
    const vals = Object.values(updates);
    await db.query(`UPDATE totals SET ${cols} WHERE site = $1`, [site, ...vals]);
  }
}

async function getTotals() {
  const res = await db.query('SELECT * FROM totals');
  const result = {};
  res.rows.forEach(row => {
    result[row.site] = {
      today: parseFloat(row.today),
      thisWeek: parseFloat(row.this_week),
      lastWeek: parseFloat(row.last_week),
      thisMonth: parseFloat(row.this_month),
      lastMonth: parseFloat(row.last_month)
    };
  });
  return result;
}

async function getCashouts() {
  const res = await db.query('SELECT * FROM cashouts ORDER BY created_at DESC LIMIT 50');
  return res.rows.map(r => ({
    tabId: r.tab_id,
    amount: parseFloat(r.amount),
    timestamp: parseInt(r.timestamp),
    site: r.site
  }));
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/') {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  if (req.method === 'POST' && req.url === '/login') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { password } = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: password === PASSWORD }));
      } catch(e) { res.writeHead(400); res.end(); }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/heartbeat') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { tabId, site } = JSON.parse(body);
        const s = getSite(site);
        if (!tabs[tabId]) tabs[tabId] = { count: 0, total: 0, site: s };
        tabs[tabId].lastSeen = Date.now();
        tabs[tabId].site = s;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(400); res.end(); }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/cashout') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { tabId, amount, timestamp, site } = JSON.parse(body);
        const s = getSite(site);
        await checkReset(s);
        await db.query('UPDATE totals SET today = today + $1 WHERE site = $2', [amount, s]);
        await db.query('INSERT INTO cashouts (tab_id, amount, timestamp, site) VALUES ($1, $2, $3, $4)', [tabId, amount, timestamp, s]);
        if (!tabs[tabId]) tabs[tabId] = { count: 0, total: 0, lastSeen: Date.now(), site: s };
        tabs[tabId].lastSeen = Date.now();
        tabs[tabId].count++;
        tabs[tabId].total += amount;
        tabs[tabId].site = s;
        console.log(`[CASHOUT] ${s} | +${amount} ZMW`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { console.error(e); res.writeHead(500); res.end(); }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/state') {
    try {
      const now = Date.now();
      Object.keys(tabs).forEach(id => {
        if (now - tabs[id].lastSeen >= TIMEOUT_MS) delete tabs[id];
      });
      await checkReset('mwos');
      await checkReset('bolabet');
      const totals = await getTotals();
      const cashouts = await getCashouts();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ totals, cashouts, tabs }));
    } catch(e) { console.error(e); res.writeHead(500); res.end(); }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

const PORT = process.env.PORT || 8080;
initDB().then(() => {
  server.listen(PORT, () => console.log('Server running on port ' + PORT));
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
