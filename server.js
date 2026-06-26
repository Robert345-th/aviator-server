const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve your frontend HTML dashboard file
app.use(express.static(path.join(__dirname, 'public')));

// Your live system data store
let sessionPassword = "your_secure_password"; // ⚠️ Replace this with your actual dashboard password!
let cashouts = []; // This stores your IDs, phone numbers, and site stats
let totals = {
  mwos: { today: 0, thisWeek: 0, lastWeek: 0, thisMonth: 0, lastMonth: 0 },
  bolabet: { today: 0, thisWeek: 0, lastWeek: 0, thisMonth: 0, lastMonth: 0 },
};
let tabs = {};

// 1. Password Verification Route
app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === sessionPassword) {
    res.json({ ok: true });
  } else {
    res.json({ ok: false });
  }
});

// 2. State Sync Route (Runs every second via frontend polling)
app.get('/state', (req, res) => {
  res.json({
    totals: totals,
    cashouts: cashouts,
    tabs: tabs
  });
});

// 3. PERMANENT CLEAR ROUTE (Wipes the actual data array from server memory)
app.post('/clear-alerts', (req, res) => {
  try {
    // This removes every single tracking alert entry that starts with "ID:" from the server completely
    cashouts = cashouts.filter(c => !c.tabId.startsWith('ID:'));
    
    console.log("Database array permanently cleared on Railway server.");
    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to clear server storage:", err);
    res.status(500).json({ error: "Internal server error clearing logs" });
  }
});

// Route for your main automation script to feed new IDs into the server
app.post('/update-state', (req, res) => {
  const { newCashouts, newTotals, newTabs } = req.body;
  if (newCashouts) cashouts = newCashouts;
  if (newTotals) totals = newTotals;
  if (newTabs) tabs = newTabs;
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Withdraw Tracker backend operational on port ${PORT}`);
});
