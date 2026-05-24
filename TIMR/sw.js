// TIMR Service Worker — Background Notifications
const CACHE_NAME = 'timr-v1';
const DB_NAME = 'timr-events';
const DB_VERSION = 1;

// ===== IndexedDB Helpers =====
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('events')) {
        db.createObjectStore('events', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function loadEventsFromDB() {
  return openDB().then(db => {
    return new Promise((resolve) => {
      const tx = db.transaction('events', 'readonly');
      const store = tx.objectStore('events');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  });
}

// ===== Event Helpers (mirror main page logic) =====
function getNextOccurrence(event) {
  const baseTime = new Date(event.datetime).getTime();
  if (event.repeat === 'none') return baseTime;
  let next = baseTime;
  while (next <= Date.now()) {
    const d = new Date(next);
    if (event.repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (event.repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (event.repeat === 'monthly') d.setMonth(d.getMonth() + 1);
    next = d.getTime();
  }
  return next;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return {
    fullDate: `${d.getMonth() + 1}月${d.getDate()}日`,
    weekday: weekDays[d.getDay()],
    time: `${hours}:${minutes}`,
  };
}

// ===== Reminder Check =====
let checkTimer = null;

function checkReminders() {
  loadEventsFromDB().then(events => {
    const now = Date.now();
    let updated = false;

    for (const ev of events) {
      const nextTime = getNextOccurrence(ev);
      const remindAt = nextTime - ev.remindBefore * 60 * 1000;

      if (now < remindAt) continue;
      if (ev.repeat === 'none' && ev.reminded) continue;

      const today = new Date().toDateString();
      if (ev.repeat !== 'none' && ev.remindedDate === today) continue;
      if (now > nextTime + 60 * 60 * 1000) {
        if (ev.repeat === 'none') { ev.reminded = true; updated = true; }
        continue;
      }

      // Show notification
      const d = formatDate(new Date(nextTime).toISOString());
      const title = 'TIMR · 事件提醒';
      const body = `「${ev.title}」— ${d.fullDate} ${d.weekday} ${d.time}`;

      self.registration.showNotification(title, {
        body,
        icon: '/icon.svg',
        badge: '/icon.svg',
        tag: ev.id + '-' + (ev.repeat !== 'none' ? today : ''),
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 400],
        data: { eventId: ev.id },
      });

      // Forward to Bark for iOS notification bar
      fetch('https://api.day.app/immjwd46NAn8ry7zYnfGPj/' + encodeURIComponent(title) + '/' + encodeURIComponent(body)).catch(() => {});

      if (ev.repeat === 'none') {
        ev.reminded = true;
      } else {
        ev.remindedDate = today;
      }
      updated = true;
    }

    if (updated) {
      saveEventsToDB(events);
    }

    // Schedule next check: find the soonest upcoming reminder
    scheduleNextFromEvents(events);
  });
}

function scheduleNextFromEvents(events) {
  if (checkTimer) { clearTimeout(checkTimer); checkTimer = null; }

  let nextRemindAt = Infinity;
  const now = Date.now();

  for (const ev of events) {
    if (ev.repeat === 'none' && ev.reminded) continue;
    const today = new Date().toDateString();
    if (ev.repeat !== 'none' && ev.remindedDate === today) continue;

    const nextTime = getNextOccurrence(ev);
    const remindAt = nextTime - ev.remindBefore * 60 * 1000;
    if (remindAt > now && remindAt < nextRemindAt) {
      nextRemindAt = remindAt;
    }
  }

  if (nextRemindAt < Infinity) {
    const delay = Math.max(10000, nextRemindAt - now + 1000);
    checkTimer = setTimeout(checkReminders, delay);
  } else {
    // No upcoming reminders, check again in 15 minutes
    checkTimer = setTimeout(checkReminders, 15 * 60 * 1000);
  }
}

function saveEventsToDB(events) {
  return openDB().then(db => {
    const tx = db.transaction('events', 'readwrite');
    const store = tx.objectStore('events');
    store.clear();
    for (const ev of events) store.put(ev);
    return new Promise(resolve => { tx.oncomplete = resolve; });
  });
}

// ===== SW Lifecycle =====
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
  // Start checking after activation
  checkReminders();
});

// Handle messages from the main page
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'sync-events') {
    saveEventsToDB(event.data.events).then(() => {
      checkReminders();
    });
  }
  if (event.data && event.data.type === 'check-now') {
    checkReminders();
  }
});

// Handle periodic background sync (Chrome Android with installed PWA)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-reminders') {
    event.waitUntil(checkReminders());
  }
});

// Notification click: open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        self.clients.openWindow('.');
      }
    })
  );
});
