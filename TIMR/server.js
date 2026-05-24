// TIMR Backend — Event Storage + iOS Bark Push
const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'events.json');
const BARK_URL = 'https://api.day.app/immjwd46NAn8ry7zYnfGPj/';

function loadEvents() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
  catch { return []; }
}

function saveEvents(events) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(events), 'utf-8'); }
  catch(e) { console.error('saveEvents error:', e.message); }
}

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
  if (isNaN(d.getTime())) return { fullDate: '?', weekday: '?', time: '?:?' };
  const days = ['周日','周一','周二','周三','周四','周五','周六'];
  return {
    fullDate: `${d.getMonth()+1}月${d.getDate()}日`,
    weekday: days[d.getDay()],
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  };
}

function checkAndNotify() {
  console.log('checkAndNotify running...');
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

    try {
      http.get(BARK_URL + encodeURIComponent(title) + '/' + encodeURIComponent(body), () => {});
    } catch(e) {}

    console.log(`Bark sent: ${ev.title} — ${d.fullDate} ${d.time}`);

    if (ev.repeat === 'none') ev.reminded = true;
    else ev.remindedDate = today;
    changed = true;
  }

  if (changed) saveEvents(events);
}

// ===== HTTP Server =====
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.method === 'GET' && req.url === '/api/health') {
    const events = loadEvents();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, events: events.length }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/sync') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (Array.isArray(data.events)) {
          saveEvents(data.events);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, count: data.events.length }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'events array required' }));
        }
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`TIMR backend running on port ${PORT}`);
});

// Check every 30 seconds using built-in setInterval (no deps needed)
setInterval(checkAndNotify, 30000);
setTimeout(checkAndNotify, 3000);
