const http = require('http');
const path = require('path');
const fs = require('fs');

let cashouts = [];
let tabs = {};

let totals = {
  mwos: { today: 0, thisWeek: 0, lastWeek: 0, thisMonth: 0, lastMonth: 0 },
  bolabet: { today: 0, thisWeek: 0, lastWeek: 0, thisMonth: 0, lastMonth: 0 }
};

let lastDayDate = '';
let lastResetDate = '';
let lastMonthDate = '';
const PASSWORD = 'R0978012009';
const TIMEOUT_MS = 3000;

function getSite(site) {
  return site === 'bolabet' ? 'bolabet' : 'mwos';
}

function checkReset() {
  const now = new Date();
  const dateStr = now.toDateString();
  const monthStr = `${now.getFullYear()}-${now.getMonth()}`;

  // Midnight daily reset — add today to this week and this month
  if (lastDayDate !== '' && lastDayDate !== dateStr) {
    totals.mwos.thisWeek += totals.mwos.today;
    totals.mwos.thisMonth += totals.mwos.today;
    totals.mwos.today = 0;
    totals.bolabet.thisWeek += totals.bolabet.today;
    totals.bolabet.thisMonth += totals.bolabet.today;
    totals.bolabet.today = 0;
    console.log('[RESET] Daily reset — today added to week and month');
  }
  if (lastDayDate !== dateStr) lastDayDate = dateStr;

  // 1st of month reset
  if (now.getDate() === 1 && lastMonthDate !== monthStr) {
    totals.mwos.lastMonth = totals.mwos.thisMonth;
    totals.mwos.thisMonth = 0;
    totals.bolabet.lastMonth = totals.bolabet.thisMonth;
    totals.bolabet.thisMonth = 0;
    lastMonthDate = monthStr;
    console.log('[RESET] Monthly reset done');
  }
  if (lastMonthDate === '') lastMonthDate = monthStr;

  // Saturday weekly reset
  if (now.getDay() === 6 && lastResetDate !== dateStr) {
    totals.mwos.lastWeek = totals.mwos.thisWeek + totals.mwos.today;
    totals.mwos.thisWeek = 0;
    totals.bolabet.lastWeek = totals.bolabet.thisWeek + totals.bolabet.today;
    totals.bolabet.thisWeek = 0;
    lastResetDate = dateStr;
    console.log('[RESET] Weekly reset done');
  }
}

setInterval(checkReset, 60000);
checkReset();

const server = http.createServer((req, res) => {
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
    req.on('end', () => {
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
    req.on('end', () => {
      try {
        const { tabId, amount, timestamp, site } = JSON.parse(body);
        const s = getSite(site);
        totals[s].today += amount;
        cashouts.unshift({ tabId, amount, timestamp, site: s });
        if (cashouts.length > 500) cashouts.pop();
        if (!tabs[tabId]) tabs[tabId] = { count: 0, total: 0, lastSeen: Date.now(), site: s };
        tabs[tabId].lastSeen = Date.now();
        tabs[tabId].count++;
        tabs[tabId].total += amount;
        tabs[tabId].site = s;
        console.log(`[CASHOUT] ${s} | +${amount} ZMW | Today: ${totals[s].today}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(400); res.end(); }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/state') {
    const now = Date.now();
    Object.keys(tabs).forEach(id => {
      if (now - tabs[id].lastSeen >= TIMEOUT_MS) delete tabs[id];
    });
    checkReset();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ totals, cashouts: cashouts.slice(0, 50), tabs }));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
