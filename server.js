const http = require('http');
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');

const PASSWORD = 'R0978012009';
const TIMEOUT_MS = 30000;

const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM;
const MY_PHONE = process.env.MY_PHONE;

function sendSMS(message) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM || !MY_PHONE) return;
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
  const body = `To=${encodeURIComponent(MY_PHONE)}&From=${encodeURIComponent(TWILIO_FROM)}&Body=${encodeURIComponent(message)}`;
  const options = {
    hostname: 'api.twilio.com',
    path: `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    }
  };
  const https = require('https');
  const req = https.request(options, r => {
    let data = '';
    r.on('data', d => data += d);
    r.on('end', () => console.log('SMS sent:', r.statusCode));
  });
  req.on('error', e => console.error('SMS error:', e));
  req.write(body);
  req.end();
}

let tabs = {};

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
  await db.query(`INSERT INTO totals (site) VALUES ('mwos') ON CONFLICT DO NOTHING`);
  await db.query(`INSERT INTO totals (site) VALUES ('bolabet') ON CONFLICT DO NOTHING`);
  console.log('Database ready!');
}

function getSite(site) {
  return site === 'bolabet' ? 'bolabet' : 'mwos';
}

// Returns current Zambia time (UTC+2) as reliable, consistent strings
// for daily/weekly/monthly reset comparisons.
function getZambiaDateParts() {
  const now = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday
  const dateStr = `${yyyy}-${mm}-${dd}`;         // e.g. "2026-07-01"
  const monthStr = `${yyyy}-${now.getUTCMonth()}`; // e.g. "2026-6"
  return { dateStr, monthStr, dayOfWeek, now };
}

async function checkReset(site) {
  const { dateStr, monthStr, dayOfWeek } = getZambiaDateParts();

  const res = await db.query('SELECT * FROM totals WHERE site = $1', [site]);
  const row = res.rows[0];
  let updates = {};

  // Daily reset — runs once per new calendar day (Zambia time)
  if (row.last_day_date !== '' && row.last_day_date !== dateStr) {
    // Add today's total to this_week and this_month accumulators
    updates.this_week = parseFloat(row.this_week) + parseFloat(row.today);
    updates.this_month = parseFloat(row.this_month) + parseFloat(row.today);
    updates.today = 0;
    console.log(`[${site}] Daily reset. today (${row.today}) → this_week/this_month`);
  }
  if (row.last_day_date !== dateStr) updates.last_day_date = dateStr;

  // Monthly reset — on the 1st of a new month
  if (dayOfWeek !== undefined && monthStr !== row.last_month_str && row.last_month_str !== '') {
    const currentThisMonth = updates.this_month !== undefined ? updates.this_month : parseFloat(row.this_month);
    updates.last_month = currentThisMonth;
    updates.this_month = 0;
    updates.last_month_str = monthStr;
    console.log(`[${site}] Monthly reset. this_month → last_month`);
  }
  if (row.last_month_str === '') updates.last_month_str = monthStr;

  // Weekly reset — on Sunday (dayOfWeek === 0), once per week
  if (dayOfWeek === 0 && row.last_week_date !== dateStr) {
    const currentThisWeek = updates.this_week !== undefined ? updates.this_week : parseFloat(row.this_week);
    updates.last_week = currentThisWeek;
    updates.this_week = 0;
    updates.last_week_date = dateStr;
    console.log(`[${site}] Weekly reset. this_week → last_week`);
  }

  if (Object.keys(updates).length > 0) {
    const cols = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
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
  // Ordered ASC by id so row positions never change between polls
  const res = await db.query('SELECT * FROM cashouts ORDER BY id ASC LIMIT 200');
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
        const data = JSON.parse(body);
        const { tabId, amount, timestamp, site } = data;
        const s = getSite(site);
        await checkReset(s);
        await db.query('UPDATE totals SET today = today + $1 WHERE site = $2', [amount, s]);
        await db.query('INSERT INTO cashouts (tab_id, amount, timestamp, site) VALUES ($1, $2, $3, $4)', [tabId, amount, timestamp, s]);
        if (!tabs[tabId]) tabs[tabId] = { count: 0, total: 0, lastSeen: Date.now(), site: s };
        tabs[tabId].lastSeen = Date.now();
        tabs[tabId].count++;
        tabs[tabId].total += amount;
        tabs[tabId].site = s;

        const todayRes = await db.query('SELECT today FROM totals WHERE site = $1', [s]);
        const todayTotal = parseFloat(todayRes.rows[0].today);

        const siteName = s === 'bolabet' ? 'BOLABET' : 'MWOS';
        const smsAmt = data.smsAmount || amount;
        sendSMS(`✅ ${siteName} CASHOUT\n+${amount} ZMW\nBalance: ${smsAmt} ZMW\nToday: ${todayTotal} ZMW\nTab: ${tabId}`);

        console.log(`[CASHOUT] ${s} | +${amount} ZMW`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { console.error(e); res.writeHead(500); res.end(); }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/clear-alerts') {
    try {
      await db.query("DELETE FROM cashouts WHERE tab_id LIKE 'ID:%'");
      console.log('Alert records cleared.');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      console.error(e);
      res.writeHead(500);
      res.end(JSON.stringify({ error: "Failed to clear alerts" }));
    }
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
