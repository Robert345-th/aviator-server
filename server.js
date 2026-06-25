const http = require('http');
const path = require('path');
const fs = require('fs');

let cashouts = [];
let tabs = {};

// Separate totals per site
let totals = {
  mwos: { thisWeek: 0, lastWeek: 0 },
  bolabet: { thisWeek: 0, lastWeek: 0 }
};

let lastResetDate = '';
const PASSWORD = 'Robz12072007';
const TIMEOUT_MS = 3000;

function getSite(site) {
  return site === 'bolabet' ? 'bolabet' : 'mwos';
}

function checkReset() {
  const now = new Date();
  const dateStr = now.toDateString();
  if (now.getDay() === 6 && lastResetDate !== dateStr) {
    totals.mwos.lastWeek = totals.mwos.thisWeek;
    totals.mwos.thisWeek = 0;
    totals.bolabet.lastWeek = totals.bolabet.thisWeek;
    totals.bolabet.thisWeek = 0;
    cashouts = [];
    lastResetDate = dateStr;
    console.log('[RESET] Weekly reset done');
  }
}

setInterval(checkReset, 60000);

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
        totals[s].thisWeek += amount;
        cashouts.unshift({ tabId, amount, timestamp, site: s });
        if (cashouts.length > 500) cashouts.pop();
        if (!tabs[tabId]) tabs[tabId] = { count: 0, total: 0, lastSeen: Date.now(), site: s };
        tabs[tabId].lastSeen = Date.now();
        tabs[tabId].count++;
        tabs[tabId].total += amount;
        tabs[tabId].site = s;
        console.log(`[CASHOUT] ${s} | Tab ${tabId} | +${amount} ZMW`);
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
    const combined = totals.mwos.thisWeek + totals.bolabet.thisWeek;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ combined, totals, cashouts: cashouts.slice(0, 50), tabs }));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
