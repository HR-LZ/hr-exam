const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ----- JSON File Helpers -----
function readJSON(filename) {
  const fp = path.join(DATA_DIR, filename);
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch(e) { return null; }
}
function writeJSON(filename, data) {
  const fp = path.join(DATA_DIR, filename);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
}
function getOrCreate(filename, defaultVal) {
  let data = readJSON(filename);
  if (data === null) { data = defaultVal; writeJSON(filename, data); }
  return data;
}

// ----- Middleware -----
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ===== AUTH =====
app.post('/api/auth/register', (req, res) => {
  const { phone, password, name } = req.body;
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) return res.json({ ok: false, error: '无效的手机号' });
  if (!password || password.length < 6) return res.json({ ok: false, error: '密码至少6位' });
  const accounts = getOrCreate('accounts.json', {});
  if (accounts[phone]) return res.json({ ok: false, error: '该手机号已注册' });
  const hash = crypto.createHash('sha256').update(phone + ':' + password).digest('hex');
  accounts[phone] = { hash, name: name || '学员', registeredAt: Date.now() };
  writeJSON('accounts.json', accounts);
  res.json({ ok: true, user: { phone, userName: name || '学员', role: 'trial', registeredAt: Date.now() } });
});

app.post('/api/auth/login', (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.json({ ok: false, error: '请输入手机号和密码' });
  // Admin login
  if (phone === '13760449307') {
    const adminHash = crypto.createHash('sha256').update(password).digest('hex');
    if (adminHash === 'ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f') {
      return res.json({ ok: true, user: { phone, userName: '管理员', role: 'admin' } });
    }
  }
  // Normal user login
  const accounts = getOrCreate('accounts.json', {});
  const acc = accounts[phone];
  if (!acc) return res.json({ ok: false, error: '账号不存在，请先注册' });
  const pwdHash = crypto.createHash('sha256').update(phone + ':' + password).digest('hex');
  if (acc.hash !== pwdHash) return res.json({ ok: false, error: '密码错误' });
  
  // Check if phone is activated
  const activated = getOrCreate('activated_phones.json', []);
  const isActivated = activated.some(p => p.phone === phone);
  if (isActivated) {
    return res.json({ ok: true, user: { phone, userName: acc.name || '学员', role: 'activated', expiresAt: Date.now() + 365*24*60*60*1000, activatedAt: Date.now() } });
  }
  res.json({ ok: true, user: { phone, userName: acc.name || '学员', role: 'trial', registeredAt: acc.registeredAt } });
});

// ===== TRIAL COUNT =====
app.get('/api/trial/:phone', (req, res) => {
  const trials = getOrCreate('trials.json', {});
  res.json({ count: trials[req.params.phone] || 0 });
});
app.post('/api/trial/:phone', (req, res) => {
  const trials = getOrCreate('trials.json', {});
  trials[req.params.phone] = (trials[req.params.phone] || 0) + 1;
  writeJSON('trials.json', trials);
  res.json({ count: trials[req.params.phone] });
});

// ===== ADMIN CODES =====
app.get('/api/admin/codes', (req, res) => {
  res.json(getOrCreate('admin_codes.json', []));
});
app.post('/api/admin/codes', (req, res) => {
  const codes = getOrCreate('admin_codes.json', []);
  codes.push(req.body);
  writeJSON('admin_codes.json', codes);
  res.json({ ok: true });
});

// ===== USED CODES =====
app.get('/api/used-codes', (req, res) => {
  res.json(getOrCreate('used_codes.json', {}));
});
app.post('/api/used-codes', (req, res) => {
  const used = getOrCreate('used_codes.json', {});
  used[req.body.hash] = Date.now();
  writeJSON('used_codes.json', used);
  res.json({ ok: true });
});

// ===== REQUESTS =====
app.get('/api/requests', (req, res) => {
  res.json(getOrCreate('requests.json', []));
});
app.post('/api/requests', (req, res) => {
  const reqs = getOrCreate('requests.json', []);
  reqs.push({ phone: req.body.phone, wechatId: req.body.wechatId, createdAt: Date.now() });
  writeJSON('requests.json', reqs);
  res.json({ ok: true });
});

// ===== TRANSACTIONS =====
app.get('/api/transactions', (req, res) => {
  res.json(getOrCreate('transactions.json', []));
});
app.post('/api/transactions', (req, res) => {
  const txns = getOrCreate('transactions.json', []);
  txns.push({ phone: req.body.phone, code: req.body.code, paidAt: Date.now() });
  writeJSON('transactions.json', txns);
  res.json({ ok: true });
});

// ===== PAYMENT CLAIMS =====
app.get('/api/payment-claims', (req, res) => {
  res.json(getOrCreate('payment_claims.json', []));
});
app.post('/api/payment-claims', (req, res) => {
  const claims = getOrCreate('payment_claims.json', []);
  // Prevent duplicate pending claims from same phone
  const existingPending = claims.find(c => c.phone === req.body.phone && c.status === 'pending');
  if (existingPending) {
    existingPending.wechat = req.body.wechat;
    existingPending.createdAt = Date.now();
    writeJSON('payment_claims.json', claims);
    return res.json({ ok: true, claim: existingPending });
  }
  const claim = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
    phone: req.body.phone, wechat: req.body.wechat,
    createdAt: Date.now(), status: 'pending', code: null
  };
  claims.push(claim);
  writeJSON('payment_claims.json', claims);
  res.json({ ok: true, claim });
});
app.put('/api/payment-claims/:id', (req, res) => {
  const claims = getOrCreate('payment_claims.json', []);
  const idx = claims.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.json({ ok: false, error: 'not found' });
  Object.assign(claims[idx], req.body);
  writeJSON('payment_claims.json', claims);
  res.json({ ok: true, claim: claims[idx] });
});

// ===== ACTIVATED PHONES =====
app.get('/api/activated-phones', (req, res) => {
  res.json(getOrCreate('activated_phones.json', []));
});
app.post('/api/activated-phones', (req, res) => {
  const phones = getOrCreate('activated_phones.json', []);
  if (!phones.some(p => p.phone === req.body.phone)) {
    phones.push({ phone: req.body.phone, activatedAt: Date.now() });
    writeJSON('activated_phones.json', phones);
  }
  res.json({ ok: true });
});

// ===== NOTIFICATIONS =====
app.get('/api/notifications', (req, res) => {
  const notifs = getOrCreate('notifications.json', []);
  const { phone, isAdmin } = req.query;
  if (isAdmin === 'true') return res.json(notifs.filter(n => n.targetPhone === 'admin'));
  if (phone) return res.json(notifs.filter(n => n.targetPhone === phone));
  res.json(notifs);
});
app.post('/api/notifications', (req, res) => {
  const notifs = getOrCreate('notifications.json', []);
  notifs.push({ targetPhone: req.body.targetPhone, type: req.body.type, message: req.body.message, read: false, createdAt: Date.now() });
  writeJSON('notifications.json', notifs);
  res.json({ ok: true });
});
app.put('/api/notifications/read', (req, res) => {
  const notifs = getOrCreate('notifications.json', []);
  const { phone, isAdmin } = req.body;
  let changed = false;
  notifs.forEach(n => {
    if (isAdmin && !n.read) { n.read = true; changed = true; }
    if (!isAdmin && phone && n.targetPhone === phone && !n.read) { n.read = true; changed = true; }
  });
  if (changed) writeJSON('notifications.json', notifs);
  res.json({ ok: true });
});
app.delete('/api/notifications', (req, res) => {
  writeJSON('notifications.json', []);
  res.json({ ok: true });
});

// ===== MESSAGES =====
app.get('/api/messages', (req, res) => {
  res.json(getOrCreate('messages.json', []));
});
app.post('/api/messages', (req, res) => {
  const msgs = getOrCreate('messages.json', []);
  const { fromPhone, fromName, toPhone, text, image } = req.body;
  const validImage = (image && typeof image === 'string' && (image.startsWith('data:image/') || image.startsWith('http'))) ? image : null;
  msgs.push({
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2,6),
    fromPhone, fromName, toPhone, text: text || '', image: validImage,
    read: false, createdAt: Date.now()
  });
  writeJSON('messages.json', msgs);
  res.json({ ok: true });
});
app.put('/api/messages/read', (req, res) => {
  const msgs = getOrCreate('messages.json', []);
  const { phone, isAdmin, fromPhone } = req.body;
  let changed = false;
  msgs.forEach(m => {
    if (isAdmin && fromPhone && m.toPhone === 'admin' && m.fromPhone === fromPhone && !m.read) { m.read = true; changed = true; }
    else if (isAdmin && !fromPhone && m.toPhone === 'admin' && !m.read) { m.read = true; changed = true; }
    else if (!isAdmin && phone && m.toPhone === phone && !m.read) { m.read = true; changed = true; }
  });
  if (changed) writeJSON('messages.json', msgs);
  res.json({ ok: true });
});

// ===== EXAM DATA (per user) =====
app.get('/api/data/:phone', (req, res) => {
  const fp = path.join(DATA_DIR, 'exam_' + req.params.phone + '.json');
  try { res.json(JSON.parse(fs.readFileSync(fp, 'utf8'))); }
  catch(e) { res.json({ wrongBook: {}, favorites: {}, practiceIdx: {}, stats: { totalAnswered: 0, totalCorrect: 0, typeStats: {}, examHistory: [] }, practiceOrder: 'seq' }); }
});
app.put('/api/data/:phone', (req, res) => {
  const fp = path.join(DATA_DIR, 'exam_' + req.params.phone + '.json');
  fs.writeFileSync(fp, JSON.stringify(req.body, null, 2), 'utf8');
  res.json({ ok: true });
});

// ===== HEALTH =====
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

// Serve SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
  console.log('Data directory: ' + DATA_DIR);
});
