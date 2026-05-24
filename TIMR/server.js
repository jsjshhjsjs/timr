// TIMR Backend — Event Storage + iOS Bark Push
const express = require('express');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const DATA_FILE = path.join(__dirname, 'events.json');
const BARK_URL = 'https://api.day.app/immjwd46NAn8ry7zYnfGPj/';

// Read/write events
function loadEvents() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
  catch { return []; }
}

function saveEvents(events) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(events), 'utf-8');
}

// Same logic as frontend: get next occurrence
function getNextOccurrence(ev) {
  const base = new Date(ev.datetime).getTime();
  if (ev.repeat === 'none') return base;
  let next = base;
  while (next <= Date.now()) {
    const d = new Date(next);
    if (ev.repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (ev.repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (ev.repeat === 'monthly') d.setMonth(d.getMonth() + 1);
    next = d.getTime();
  }
  return next;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const days = ['周日','周一','周二','周三','周四','周五','周六'];
  const mm = String(d.getMinutes()).padStart(2, '0');
  return {
    fullDate: `${d.getMonth()+1}月${d.getDate()}日`,
    weekday: days[d.getDay()],
    time: `${String(d.getHours()).padStart(2, '0')}:${mm}`,
  };
}

// ===== API: Sync events from frontend =====
app.post('/api/sync', (req, res) => {
  const events = req.body.events;
  if (!Array.isArray(events)) return res.status(400).json({ error: 'events array required' });
  saveEvents(events);
  res.json({ ok: true, count: events.length });
});

// ===== API: Manual trigger check =====
app.post('/api/check', (req, res) => {
  checkAndNotify();
  res.json({ ok: true });
});

// ===== API: Health check =====
app.get('/api/health', (req, res) => {
  const events = loadEvents();
  res.json({ ok: true, events: events.length });
});

// ===== Core: Check events and send Bark =====
function checkAndNotify() {
  const events = loadEvents();
  const now = Date.now();
  let changed = false;

  for (const ev of events) {
    const nextTime = getNextOccurrence(ev);
    const remindAt = nextTime - ev.remindBefore * 60 * 1000;
    if (now < remindAt) continue;
    if (ev.repeat === 'none' && ev.reminded) continue;
    const today = new Date().toDateString();
    if (ev.repeat !== 'none' && ev.remindedDate === today) continue;
    if (now > nextTime + 60 * 60 * 1000) {
      if (ev.repeat === 'none') { ev.reminded = true; changed = true; }
      continue;
    }

    const d = formatDate(new Date(nextTime).toISOString());
    const title = 'TIMR · 事件提醒';
    const body = `「${ev.title}」— ${d.fullDate} ${d.weekday} ${d.time}`;

    // Send Bark notification
    fetch(BARK_URL + encodeURIComponent(title) + '/' + encodeURIComponent(body))
      .catch(() => {});

    console.log(`Bark sent: ${ev.title} — ${d.fullDate} ${d.time}`);

    if (ev.repeat === 'none') ev.reminded = true;
    else ev.remindedDate = today;
    changed = true;
  }

  if (changed) saveEvents(events);
}

// Run check every 30 seconds
cron.schedule('* * * * *', checkAndNotify);
cron.schedule('* * * * *', checkAndNotify); // Run twice per minute

// Also initial check
setTimeout(checkAndNotify, 5000);

// ===== Start server =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TIMR backend running on port ${PORT}`);
});
