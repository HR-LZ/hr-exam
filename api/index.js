// Vercel Serverless Function - HR Exam API
const crypto = require('crypto');
const { readJSON, writeJSON, getOrCreate } = require('../lib/kv-store');

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Parse the URL path: /api/some/endpoint/123
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    // ===== AUTH =====
    if (path === '/api/auth/register' && req.method === 'POST') {
      const body = parseBody(req);
      const { phone, password, name } = body;
      if (!phone || !/^1[3-9]\d{9}$/.test(phone)) return json(res, { ok: false, error: '无效的手机号' });
      if (!password || password.length < 6) return json(res, { ok: false, error: '密码至少6位' });
      const accounts = await getOrCreate('accounts', 'main', {});
      if (accounts[phone]) return json(res, { ok: false, error: '该手机号已注册' });
      const hash = crypto.createHash('sha256').update(phone + ':' + password).digest('hex');
      accounts[phone] = { hash, name: name || '学员', registeredAt: Date.now() };
      await writeJSON('accounts', 'main', accounts);
      return json(res, { ok: true, user: { phone, userName: name || '学员', role: 'trial', registeredAt: Date.now() } });
    }

    if (path === '/api/auth/login' && req.method === 'POST') {
      const body = parseBody(req);
      const { phone, password } = body;
      if (!phone || !password) return json(res, { ok: false, error: '请输入手机号和密码' });
      if (phone === '13760449307') {
        const adminHash = crypto.createHash('sha256').update(password).digest('hex');
        if (adminHash === 'ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f') {
          return json(res, { ok: true, user: { phone, userName: '管理员', role: 'admin' } });
        }
      }
      const accounts = await getOrCreate('accounts', 'main', {});
      const acc = accounts[phone];
      if (!acc) return json(res, { ok: false, error: '账号不存在，请先注册' });
      const pwdHash = crypto.createHash('sha256').update(phone + ':' + password).digest('hex');
      if (acc.hash !== pwdHash) return json(res, { ok: false, error: '密码错误' });
      const activated = await getOrCreate('activated_phones', 'main', []);
      const isActivated = Array.isArray(activated) && activated.some(p => p.phone === phone);
      if (isActivated) {
        return json(res, { ok: true, user: { phone, userName: acc.name || '学员', role: 'activated', expiresAt: Date.now() + 365*24*60*60*1000, activatedAt: Date.now() } });
      }
      return json(res, { ok: true, user: { phone, userName: acc.name || '学员', role: 'trial', registeredAt: acc.registeredAt } });
    }

    // ===== TRIAL COUNT =====
    const trialMatch = path.match(/^\/api\/trial\/(\d+)$/);
    if (trialMatch) {
      const phone = trialMatch[1];
      if (req.method === 'GET') {
        const trials = await getOrCreate('trials', 'main', {});
        return json(res, { count: trials[phone] || 0 });
      }
      if (req.method === 'POST') {
        const trials = await getOrCreate('trials', 'main', {});
        trials[phone] = (trials[phone] || 0) + 1;
        await writeJSON('trials', 'main', trials);
        return json(res, { count: trials[phone] });
      }
    }

    // ===== ADMIN CODES =====
    if (path === '/api/admin/codes') {
      if (req.method === 'GET') return json(res, await getOrCreate('admin_codes', 'main', []));
      if (req.method === 'POST') {
        const codes = await getOrCreate('admin_codes', 'main', []);
        codes.push(parseBody(req));
        await writeJSON('admin_codes', 'main', codes);
        return json(res, { ok: true });
      }
    }

    // ===== USED CODES =====
    if (path === '/api/used-codes') {
      if (req.method === 'GET') return json(res, await getOrCreate('used_codes', 'main', {}));
      if (req.method === 'POST') {
        const used = await getOrCreate('used_codes', 'main', {});
        used[parseBody(req).hash] = Date.now();
        await writeJSON('used_codes', 'main', used);
        return json(res, { ok: true });
      }
    }

    // ===== REQUESTS =====
    if (path === '/api/requests') {
      if (req.method === 'GET') return json(res, await getOrCreate('requests', 'main', []));
      if (req.method === 'POST') {
        const reqs = await getOrCreate('requests', 'main', []);
        const body = parseBody(req);
        reqs.push({ phone: body.phone, wechatId: body.wechatId, createdAt: Date.now() });
        await writeJSON('requests', 'main', reqs);
        return json(res, { ok: true });
      }
    }

    // ===== TRANSACTIONS =====
    if (path === '/api/transactions') {
      if (req.method === 'GET') return json(res, await getOrCreate('transactions', 'main', []));
      if (req.method === 'POST') {
        const txns = await getOrCreate('transactions', 'main', []);
        const body = parseBody(req);
        txns.push({ phone: body.phone, code: body.code, paidAt: Date.now() });
        await writeJSON('transactions', 'main', txns);
        return json(res, { ok: true });
      }
    }

    // ===== PAYMENT CLAIMS =====
    if (path === '/api/payment-claims') {
      if (req.method === 'GET') return json(res, await getOrCreate('payment_claims', 'main', []));
      if (req.method === 'POST') {
        const claims = await getOrCreate('payment_claims', 'main', []);
        const body = parseBody(req);
        const existingPending = claims.find(c => c.phone === body.phone && c.status === 'pending');
        if (existingPending) {
          existingPending.wechat = body.wechat;
          existingPending.createdAt = Date.now();
          await writeJSON('payment_claims', 'main', claims);
          return json(res, { ok: true, claim: existingPending });
        }
        const claim = {
          id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
          phone: body.phone, wechat: body.wechat,
          createdAt: Date.now(), status: 'pending', code: null
        };
        claims.push(claim);
        await writeJSON('payment_claims', 'main', claims);
        return json(res, { ok: true, claim });
      }
    }

    const claimIdMatch = path.match(/^\/api\/payment-claims\/(.+)$/);
    if (claimIdMatch && req.method === 'PUT') {
      const claims = await getOrCreate('payment_claims', 'main', []);
      const idx = claims.findIndex(c => c.id === claimIdMatch[1]);
      if (idx === -1) return json(res, { ok: false, error: 'not found' });
      Object.assign(claims[idx], parseBody(req));
      await writeJSON('payment_claims', 'main', claims);
      return json(res, { ok: true, claim: claims[idx] });
    }

    // ===== ACTIVATED PHONES =====
    if (path === '/api/activated-phones') {
      if (req.method === 'GET') return json(res, await getOrCreate('activated_phones', 'main', []));
      if (req.method === 'POST') {
        const phones = await getOrCreate('activated_phones', 'main', []);
        const body = parseBody(req);
        if (!phones.some(p => p.phone === body.phone)) {
          phones.push({ phone: body.phone, activatedAt: Date.now() });
          await writeJSON('activated_phones', 'main', phones);
        }
        return json(res, { ok: true });
      }
    }

    // ===== NOTIFICATIONS =====
    if (path === '/api/notifications') {
      if (req.method === 'GET') {
        const notifs = await getOrCreate('notifications', 'main', []);
        const phone = url.searchParams.get('phone');
        const isAdmin = url.searchParams.get('isAdmin');
        if (isAdmin === 'true') return json(res, notifs.filter(n => n.targetPhone === 'admin'));
        if (phone) return json(res, notifs.filter(n => n.targetPhone === phone));
        return json(res, notifs);
      }
      if (req.method === 'POST') {
        const notifs = await getOrCreate('notifications', 'main', []);
        const body = parseBody(req);
        notifs.push({ targetPhone: body.targetPhone, type: body.type, message: body.message, read: false, createdAt: Date.now() });
        await writeJSON('notifications', 'main', notifs);
        return json(res, { ok: true });
      }
      if (req.method === 'DELETE') {
        await writeJSON('notifications', 'main', []);
        return json(res, { ok: true });
      }
    }

    if (path === '/api/notifications/read' && req.method === 'PUT') {
      const notifs = await getOrCreate('notifications', 'main', []);
      const body = parseBody(req);
      const { phone, isAdmin } = body;
      let changed = false;
      notifs.forEach(n => {
        if (isAdmin && !n.read) { n.read = true; changed = true; }
        if (!isAdmin && phone && n.targetPhone === phone && !n.read) { n.read = true; changed = true; }
      });
      if (changed) await writeJSON('notifications', 'main', notifs);
      return json(res, { ok: true });
    }

    // ===== MESSAGES =====
    if (path === '/api/messages') {
      if (req.method === 'GET') return json(res, await getOrCreate('messages', 'main', []));
      if (req.method === 'POST') {
        const msgs = await getOrCreate('messages', 'main', []);
        const body = parseBody(req);
        const { fromPhone, fromName, toPhone, text, image } = body;
        const validImage = (image && typeof image === 'string' && (image.startsWith('data:image/') || image.startsWith('http'))) ? image : null;
        msgs.push({
          id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
          fromPhone, fromName, toPhone, text: text || '', image: validImage,
          read: false, createdAt: Date.now()
        });
        await writeJSON('messages', 'main', msgs);
        return json(res, { ok: true });
      }
    }

    if (path === '/api/messages/read' && req.method === 'PUT') {
      const msgs = await getOrCreate('messages', 'main', []);
      const body = parseBody(req);
      const { phone, isAdmin, fromPhone } = body;
      let changed = false;
      msgs.forEach(m => {
        if (isAdmin && fromPhone && m.toPhone === 'admin' && m.fromPhone === fromPhone && !m.read) { m.read = true; changed = true; }
        else if (isAdmin && !fromPhone && m.toPhone === 'admin' && !m.read) { m.read = true; changed = true; }
        else if (!isAdmin && phone && m.toPhone === phone && !m.read) { m.read = true; changed = true; }
      });
      if (changed) await writeJSON('messages', 'main', msgs);
      return json(res, { ok: true });
    }

    // ===== EXAM DATA (per user) =====
    const dataMatch = path.match(/^\/api\/data\/(\d+)$/);
    if (dataMatch) {
      const phone = dataMatch[1];
      if (req.method === 'GET') {
        const data = await readJSON('exam_data', phone);
        if (data) return json(res, data);
        return json(res, { wrongBook: {}, favorites: {}, practiceIdx: {}, stats: { totalAnswered: 0, totalCorrect: 0, typeStats: {}, examHistory: [] }, practiceOrder: 'seq' });
      }
      if (req.method === 'PUT') {
        await writeJSON('exam_data', phone, parseBody(req));
        return json(res, { ok: true });
      }
    }

    // ===== HEALTH =====
    if (path === '/api/health') {
      return json(res, { ok: true, time: Date.now(), platform: 'vercel' });
    }

    // ===== 404 =====
    return json(res, { ok: false, error: 'Not found: ' + path }, 404);

  } catch (e) {
    console.error('[API Error]', path, e.message);
    return json(res, { ok: false, error: '服务器内部错误' }, 500);
  }
};

// ---- Helpers ----
function parseBody(req) {
  if (req._body) return req._body;
  try {
    req._body = JSON.parse(req.body || '{}');
  } catch (e) {
    req._body = {};
  }
  return req._body;
}

function json(res, data, statusCode = 200) {
  res.status(statusCode).json(data);
}
