const http = require('http');
const fs = require('fs');
const path = require('path');

let cashouts = [];
let totalProfit = 0;
let tabs = {};

const TIMEOUT_MS = 3000; // remove tab after 3 seconds of no heartbeat

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

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

    if (req.method === 'GET' && req.url === '/state') {
        const now = Date.now();
        // Clean dead tabs
        Object.keys(tabs).forEach(id => {
            if (now - tabs[id].lastSeen >= TIMEOUT_MS) delete tabs[id];
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ totalProfit, cashouts: cashouts.slice(0, 50), tabs }));
        return;
    }

    if (req.method === 'GET' && req.url === '/') {
        const html = fs.readFileSync(path.join(__dirname, 'dashboard-v2.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
    }

    res.writeHead(404); res.end('Not found');
});

server.listen(3000, () => {
    console.log('\n✅  Aviator Receiver v3 running at http://localhost:3000\n');
});
