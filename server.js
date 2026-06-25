const http = require('http');
const fs = require('fs');
const path = require('path');

let cashouts = [];
let totalProfit = 0;
let lastWeekTotal = 0;
let lastResetDate = null;
let tabs = {};

const TIMEOUT_MS = 3000;
const PASSWORD = 'Robz12072007'; // ← CHANGE THIS TO YOUR PASSWORD

// Check and reset every Saturday
function checkWeeklyReset() {
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 6=Sat
    const dateStr = now.toDateString();

    if (day === 6 && lastResetDate !== dateStr) {
        lastWeekTotal = totalProfit;
        totalProfit = 0;
        cashouts = [];
        lastResetDate = dateStr;
        console.log(`[RESET] Weekly reset done. Last week total: ${lastWeekTotal} ZMW`);
    }
}

// Check reset every hour
setInterval(checkWeeklyReset, 3600000);
checkWeeklyReset();

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Password');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // ── AUTH CHECK for dashboard ──
    if (req.method === 'GET' && req.url === '/') {
        const html = fs.readFileSync(path.join(__dirname, 'dashboard-final.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
    }

    // ── LOGIN ──
    if (req.method === 'POST' && req.url === '/login') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { password } = JSON.parse(body);
                if (password === PASSWORD) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'Wrong password' }));
                }
            } catch(e) { res.writeHead(400); res.end(); }
        });
        return;
    }

    // ── HEARTBEAT ──
    if (req.method === 'POST' && req.url === '/heartbeat') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { tabId } = JSON.parse(body);
                if (!tabs[tabId]) tabs[tabId] = { count: 0, total: 0 };
                tabs[tabId].lastSeen = Date.now();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            } catch(e) { res.writeHead(400); res.end(); }
        });
        return;
    }

    // ── CASHOUT ──
    if (req.method === 'POST' && req.url === '/cashout') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { tabId, amount, timestamp } = JSON.parse(body);
                totalProfit += amount;
                cashouts.unshift({ tabId, amount, timestamp, total: totalProfit });
                if (cashouts.length > 500) cashouts.pop();
                if (!tabs[tabId]) tabs[tabId] = { count: 0, total: 0, lastSeen: Date.now() };
                tabs[tabId].lastSeen = Date.now();
                tabs[tabId].count++;
                tabs[tabId].total += amount;
                console.log(`[CASHOUT] Tab ${tabId} | +${amount} ZMW | TOTAL: ${totalProfit} ZMW`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, totalProfit }));
            } catch(e) { res.writeHead(400); res.end(); }
        });
        return;
    }

    // ── STATE ──
    if (req.method === 'GET' && req.url === '/state') {
        const now = Date.now();
        Object.keys(tabs).forEach(id => {
            if (now - tabs[id].lastSeen >= TIMEOUT_MS) delete tabs[id];
        });
        checkWeeklyReset();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ totalProfit, lastWeekTotal, cashouts: cashouts.slice(0, 50), tabs }));
        return;
    }

    res.writeHead(404); res.end('Not found');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n✅  Aviator Final Server running on port ${PORT}\n`);
});
