const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const PORT = process.env.PORT || 3999;
const DATABASE_URL = process.env.DATABASE_URL;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'aleyana.vdy@gmail.com';
const COOKIE_NAME = 'lipo_session';
const TRIAL_DAYS = 30;

// ==================== FILES ====================
const FILES = {
  landing: path.join(__dirname, 'landing.html'),
  app: path.join(__dirname, 'index.html'),
  auth: path.join(__dirname, 'auth.html'),
  legal: path.join(__dirname, 'legal.html'),
};
const DB_FILE = path.join(__dirname, 'data.json');

// ==================== DATABASE ====================
let pool = null;
if (DATABASE_URL) {
  pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

async function initDB() {
  if (!pool) return;

  // Users table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT,
      google_id TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      trial_ends_at TIMESTAMPTZ,
      subscription_ends_at TIMESTAMPTZ,
      promo_used TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Sessions table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Promo codes table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      code TEXT PRIMARY KEY,
      free_days INTEGER NOT NULL DEFAULT 30,
      max_uses INTEGER DEFAULT NULL,
      used_count INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // User data (per-user app data)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Worker invitations
  await pool.query(`
    CREATE TABLE IF NOT EXISTS worker_invites (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      permissions JSONB NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Worker links (owner <-> worker)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS worker_links (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      worker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      worker_name TEXT NOT NULL DEFAULT '',
      permissions JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(owner_id, worker_id)
    )
  `);

  console.log('PostgreSQL connected, tables ready');
}

// ==================== USER DATA READ/WRITE ====================
async function readUserData(userId) {
  if (pool) {
    const res = await pool.query("SELECT data FROM app_data WHERE id = $1", [userId]);
    return res.rows.length ? res.rows[0].data : {};
  }
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return {}; }
}

async function writeUserData(userId, data) {
  if (pool) {
    await pool.query(
      `INSERT INTO app_data (id, data, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
      [userId, JSON.stringify(data)]
    );
    return;
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ==================== AUTH HELPERS ====================
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateId() {
  return crypto.randomBytes(12).toString('hex');
}

function parseCookies(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, v] = c.trim().split('=');
    if (k) cookies[k] = v;
  });
  return cookies;
}

function setSessionCookie(res, token, maxAgeDays) {
  const maxAge = maxAgeDays * 24 * 60 * 60;
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${BASE_URL.startsWith('https') ? '; Secure' : ''}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
}

async function getSessionUser(req) {
  if (!pool) return { id: 'local', email: 'local', name: 'Local', role: 'admin', hasAccess: true };
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const res = await pool.query(
    `SELECT u.* FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = $1 AND s.expires_at > NOW()`,
    [token]
  );
  if (!res.rows.length) return null;
  const user = res.rows[0];
  user.hasAccess = checkAccess(user);

  // Check if this user is a linked worker
  const wl = await pool.query(
    `SELECT wl.*, u.name as owner_name FROM worker_links wl JOIN users u ON wl.owner_id = u.id WHERE wl.worker_id = $1`,
    [user.id]
  );
  if (wl.rows.length) {
    user.isWorker = true;
    user.ownerId = wl.rows[0].owner_id;
    user.ownerName = wl.rows[0].owner_name;
    user.workerPermissions = wl.rows[0].permissions || {};
    user.hasAccess = true; // Workers always have access through owner
  }
  return user;
}

function checkAccess(user) {
  if (user.role === 'admin') return true;
  const now = new Date();
  if (user.trial_ends_at && new Date(user.trial_ends_at) > now) return true;
  if (user.subscription_ends_at && new Date(user.subscription_ends_at) > now) return true;
  return false;
}

async function createSession(res, userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  if (pool) {
    await pool.query(
      "INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)",
      [token, userId, expiresAt]
    );
  }
  setSessionCookie(res, token, 30);
}

// ==================== HELPERS ====================
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function serveFile(res, filePath) {
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) { res.writeHead(500); res.end('Error'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
}

function redirect(res, url) {
  res.writeHead(302, { Location: url });
  res.end();
}

// ==================== SERVER ====================
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const query = new URL(req.url, BASE_URL).searchParams;

  try {
    // ---- CORS preflight ----
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
      res.end();
      return;
    }

    // ---- AUTH: Register ----
    if (req.method === 'POST' && url === '/api/auth/register') {
      if (!pool) { sendJSON(res, 400, { error: 'Auth not available locally' }); return; }
      const body = JSON.parse(await readBody(req));
      const { name, email, password, promo } = body;
      if (!email || !password || !name) { sendJSON(res, 400, { error: 'Заповніть всі поля' }); return; }
      if (password.length < 6) { sendJSON(res, 400, { error: 'Пароль мінімум 6 символів' }); return; }

      // Check existing
      const exists = await pool.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
      if (exists.rows.length) { sendJSON(res, 400, { error: 'Цей email вже зареєстровано' }); return; }

      // Promo code
      let bonusDays = 0;
      if (promo) {
        const pr = await pool.query("SELECT * FROM promo_codes WHERE code = $1 AND active = true", [promo.toUpperCase()]);
        if (pr.rows.length) {
          const p = pr.rows[0];
          if (p.max_uses && p.used_count >= p.max_uses) {
            sendJSON(res, 400, { error: 'Промокод вже використано максимальну кількість разів' }); return;
          }
          bonusDays = p.free_days;
          await pool.query("UPDATE promo_codes SET used_count = used_count + 1 WHERE code = $1", [promo.toUpperCase()]);
        } else {
          sendJSON(res, 400, { error: 'Невірний промокод' }); return;
        }
      }

      const userId = generateId();
      const hash = await bcrypt.hash(password, 10);
      const trialEnds = new Date(Date.now() + (TRIAL_DAYS + bonusDays) * 24 * 60 * 60 * 1000);
      const role = email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'user';

      await pool.query(
        `INSERT INTO users (id, email, name, password_hash, role, trial_ends_at, promo_used)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [userId, email.toLowerCase(), name, hash, role, trialEnds, promo || null]
      );

      // Check for pending worker invites for this email
      if (pool) {
        const invites = await pool.query(
          "SELECT * FROM worker_invites WHERE email = $1 AND status = 'pending'",
          [email.toLowerCase()]
        );
        for (const inv of invites.rows) {
          const linkId = generateId();
          await pool.query(
            `INSERT INTO worker_links (id, owner_id, worker_id, worker_name, permissions) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (owner_id, worker_id) DO NOTHING`,
            [linkId, inv.owner_id, userId, name, JSON.stringify(inv.permissions)]
          );
          await pool.query("UPDATE worker_invites SET status = 'accepted' WHERE id = $1", [inv.id]);
        }
      }

      await createSession(res, userId);
      sendJSON(res, 200, { ok: true });
      return;
    }

    // ---- AUTH: Login ----
    if (req.method === 'POST' && url === '/api/auth/login') {
      if (!pool) { sendJSON(res, 400, { error: 'Auth not available locally' }); return; }
      const body = JSON.parse(await readBody(req));
      const { email, password } = body;
      if (!email || !password) { sendJSON(res, 400, { error: 'Введіть email та пароль' }); return; }

      const result = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
      if (!result.rows.length) { sendJSON(res, 400, { error: 'Невірний email або пароль' }); return; }

      const user = result.rows[0];
      if (!user.password_hash) { sendJSON(res, 400, { error: 'Цей акаунт використовує вхід через Google' }); return; }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) { sendJSON(res, 400, { error: 'Невірний email або пароль' }); return; }

      await createSession(res, user.id);
      sendJSON(res, 200, { ok: true });
      return;
    }

    // ---- AUTH: Logout ----
    if (url === '/api/auth/logout') {
      const cookies = parseCookies(req);
      const token = cookies[COOKIE_NAME];
      if (token && pool) {
        await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
      }
      clearSessionCookie(res);
      redirect(res, '/');
      return;
    }

    // ---- AUTH: Google OAuth start ----
    if (url === '/api/auth/google') {
      if (!GOOGLE_CLIENT_ID) { sendJSON(res, 400, { error: 'Google OAuth не налаштовано' }); return; }
      const redirectUri = `${BASE_URL}/api/auth/google/callback`;
      const googleUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=email%20profile&access_type=offline`;
      redirect(res, googleUrl);
      return;
    }

    // ---- AUTH: Google OAuth callback ----
    if (url === '/api/auth/google/callback') {
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) { sendJSON(res, 400, { error: 'Google OAuth not configured' }); return; }
      const code = query.get('code');
      if (!code) { redirect(res, '/login?error=google_failed'); return; }

      // Exchange code for tokens
      const redirectUri = `${BASE_URL}/api/auth/google/callback`;
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' })
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) { redirect(res, '/login?error=google_failed'); return; }

      // Get user info
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const googleUser = await userRes.json();
      if (!googleUser.email) { redirect(res, '/login?error=google_failed'); return; }

      // Find or create user
      let result = await pool.query("SELECT * FROM users WHERE email = $1", [googleUser.email.toLowerCase()]);
      let userId;
      if (result.rows.length) {
        userId = result.rows[0].id;
        if (!result.rows[0].google_id) {
          await pool.query("UPDATE users SET google_id = $1 WHERE id = $2", [googleUser.id, userId]);
        }
      } else {
        userId = generateId();
        const trialEnds = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
        const role = googleUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'user';
        await pool.query(
          `INSERT INTO users (id, email, name, google_id, role, trial_ends_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [userId, googleUser.email.toLowerCase(), googleUser.name || '', googleUser.id, role, trialEnds]
        );
        // Check for pending worker invites
        const invites = await pool.query(
          "SELECT * FROM worker_invites WHERE email = $1 AND status = 'pending'",
          [googleUser.email.toLowerCase()]
        );
        for (const inv of invites.rows) {
          const linkId = generateId();
          await pool.query(
            `INSERT INTO worker_links (id, owner_id, worker_id, worker_name, permissions) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (owner_id, worker_id) DO NOTHING`,
            [linkId, inv.owner_id, userId, googleUser.name || '', JSON.stringify(inv.permissions)]
          );
          await pool.query("UPDATE worker_invites SET status = 'accepted' WHERE id = $1", [inv.id]);
        }
      }

      await createSession(res, userId);
      redirect(res, '/app');
      return;
    }

    // ---- AUTH: Get current user info ----
    if (req.method === 'GET' && url === '/api/auth/me') {
      const user = await getSessionUser(req);
      if (!user) { sendJSON(res, 401, { error: 'Not authenticated' }); return; }
      const response = {
        id: user.id, email: user.email, name: user.name, role: user.role,
        hasAccess: user.hasAccess,
        trialEndsAt: user.trial_ends_at,
        subscriptionEndsAt: user.subscription_ends_at
      };
      if (user.isWorker) {
        response.isWorker = true;
        response.ownerId = user.ownerId;
        response.ownerName = user.ownerName;
        response.workerPermissions = user.workerPermissions;
      }
      sendJSON(res, 200, response);
      return;
    }

    // ---- ADMIN: Promo codes ----
    if (req.method === 'POST' && url === '/api/admin/promo') {
      const user = await getSessionUser(req);
      if (!user || user.role !== 'admin') { sendJSON(res, 403, { error: 'Forbidden' }); return; }
      const body = JSON.parse(await readBody(req));
      const { code, freeDays, maxUses } = body;
      if (!code || !freeDays) { sendJSON(res, 400, { error: 'Code and freeDays required' }); return; }
      await pool.query(
        "INSERT INTO promo_codes (code, free_days, max_uses) VALUES ($1, $2, $3) ON CONFLICT (code) DO UPDATE SET free_days=$2, max_uses=$3, active=true",
        [code.toUpperCase(), freeDays, maxUses || null]
      );
      sendJSON(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url === '/api/admin/promo') {
      const user = await getSessionUser(req);
      if (!user || user.role !== 'admin') { sendJSON(res, 403, { error: 'Forbidden' }); return; }
      const result = await pool.query("SELECT * FROM promo_codes ORDER BY created_at DESC");
      sendJSON(res, 200, result.rows);
      return;
    }

    if (req.method === 'GET' && url === '/api/admin/users') {
      const user = await getSessionUser(req);
      if (!user || user.role !== 'admin') { sendJSON(res, 403, { error: 'Forbidden' }); return; }
      const result = await pool.query("SELECT id, email, name, role, trial_ends_at, subscription_ends_at, promo_used, created_at FROM users ORDER BY created_at DESC");
      sendJSON(res, 200, result.rows);
      return;
    }

    // ---- AUTH: Delete account ----
    if (req.method === 'POST' && url === '/api/auth/delete-account') {
      const user = await getSessionUser(req);
      if (!user) { sendJSON(res, 401, { error: 'Not authenticated' }); return; }
      const body = JSON.parse(await readBody(req));
      if (body.confirmEmail !== user.email) { sendJSON(res, 400, { error: 'Email не співпадає' }); return; }
      // Delete user data, sessions, then user
      await pool.query("DELETE FROM app_data WHERE id = $1", [user.id]);
      await pool.query("DELETE FROM sessions WHERE user_id = $1", [user.id]);
      await pool.query("DELETE FROM users WHERE id = $1", [user.id]);
      clearSessionCookie(res);
      sendJSON(res, 200, { ok: true });
      return;
    }

    // ---- WORKERS: Invite worker ----
    if (req.method === 'POST' && url === '/api/workers/invite') {
      const user = await getSessionUser(req);
      if (!user || user.isWorker) { sendJSON(res, 403, { error: 'Forbidden' }); return; }
      const body = JSON.parse(await readBody(req));
      const { email, name, permissions } = body;
      if (!email) { sendJSON(res, 400, { error: 'Вкажіть email майстра' }); return; }

      // Check if already linked
      const existingLink = await pool.query(
        `SELECT wl.id FROM worker_links wl JOIN users u ON wl.worker_id = u.id WHERE wl.owner_id = $1 AND u.email = $2`,
        [user.id, email.toLowerCase()]
      );
      if (existingLink.rows.length) { sendJSON(res, 400, { error: 'Цей майстер вже підключений' }); return; }

      // Check if user exists
      const existingUser = await pool.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);

      const defaultPerms = {
        orders: true, production: true, workerStock: true,
        materials: false, materialPrices: false, sellPrices: false,
        costs: false, salary: false, equipment: false, settings: false, dashboard: true
      };
      const perms = permissions || defaultPerms;

      if (existingUser.rows.length) {
        // User already registered — link directly
        const workerId = existingUser.rows[0].id;
        if (workerId === user.id) { sendJSON(res, 400, { error: 'Не можна додати себе як майстра' }); return; }
        const linkId = generateId();
        await pool.query(
          `INSERT INTO worker_links (id, owner_id, worker_id, worker_name, permissions) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (owner_id, worker_id) DO NOTHING`,
          [linkId, user.id, workerId, name || '', JSON.stringify(perms)]
        );
        sendJSON(res, 200, { ok: true, linked: true });
      } else {
        // Create invitation token
        const inviteId = generateId();
        const token = generateToken();
        await pool.query(
          `INSERT INTO worker_invites (id, owner_id, email, token, permissions, status) VALUES ($1, $2, $3, $4, $5, 'pending')`,
          [inviteId, user.id, email.toLowerCase(), token, JSON.stringify(perms)]
        );
        // For now, return the invite link (later could send via email)
        const inviteUrl = `${BASE_URL}/register?invite=${token}`;
        sendJSON(res, 200, { ok: true, linked: false, inviteUrl });
      }
      return;
    }

    // ---- WORKERS: List my workers ----
    if (req.method === 'GET' && url === '/api/workers') {
      const user = await getSessionUser(req);
      if (!user) { sendJSON(res, 401, { error: 'Not authenticated' }); return; }
      if (user.isWorker) { sendJSON(res, 403, { error: 'Forbidden' }); return; }

      const links = await pool.query(
        `SELECT wl.id, wl.worker_id, wl.worker_name, wl.permissions, wl.created_at, u.email, u.name as user_name
         FROM worker_links wl JOIN users u ON wl.worker_id = u.id WHERE wl.owner_id = $1 ORDER BY wl.created_at`,
        [user.id]
      );
      const invites = await pool.query(
        `SELECT id, email, status, created_at FROM worker_invites WHERE owner_id = $1 AND status = 'pending' ORDER BY created_at`,
        [user.id]
      );
      sendJSON(res, 200, { workers: links.rows, pendingInvites: invites.rows });
      return;
    }

    // ---- WORKERS: Update permissions ----
    if (req.method === 'POST' && url === '/api/workers/permissions') {
      const user = await getSessionUser(req);
      if (!user || user.isWorker) { sendJSON(res, 403, { error: 'Forbidden' }); return; }
      const body = JSON.parse(await readBody(req));
      const { linkId, permissions } = body;
      if (!linkId || !permissions) { sendJSON(res, 400, { error: 'Missing data' }); return; }
      await pool.query(
        `UPDATE worker_links SET permissions = $1 WHERE id = $2 AND owner_id = $3`,
        [JSON.stringify(permissions), linkId, user.id]
      );
      sendJSON(res, 200, { ok: true });
      return;
    }

    // ---- WORKERS: Remove worker ----
    if (req.method === 'POST' && url === '/api/workers/remove') {
      const user = await getSessionUser(req);
      if (!user || user.isWorker) { sendJSON(res, 403, { error: 'Forbidden' }); return; }
      const body = JSON.parse(await readBody(req));
      const { linkId } = body;
      await pool.query("DELETE FROM worker_links WHERE id = $1 AND owner_id = $2", [linkId, user.id]);
      sendJSON(res, 200, { ok: true });
      return;
    }

    // ---- WORKERS: Cancel invite ----
    if (req.method === 'POST' && url === '/api/workers/cancel-invite') {
      const user = await getSessionUser(req);
      if (!user || user.isWorker) { sendJSON(res, 403, { error: 'Forbidden' }); return; }
      const body = JSON.parse(await readBody(req));
      const { inviteId } = body;
      await pool.query("DELETE FROM worker_invites WHERE id = $1 AND owner_id = $2", [inviteId, user.id]);
      sendJSON(res, 200, { ok: true });
      return;
    }

    // ---- API: GET user data ----
    if (req.method === 'GET' && url === '/api/data') {
      const user = await getSessionUser(req);
      if (!user) { sendJSON(res, 401, { error: 'Not authenticated' }); return; }
      // Workers read owner's data
      const dataUserId = user.isWorker ? user.ownerId : user.id;
      const data = await readUserData(dataUserId);
      sendJSON(res, 200, data);
      return;
    }

    // ---- API: POST user data ----
    if (req.method === 'POST' && url === '/api/data') {
      const user = await getSessionUser(req);
      if (!user) { sendJSON(res, 401, { error: 'Not authenticated' }); return; }
      // Workers write to owner's data
      const dataUserId = user.isWorker ? user.ownerId : user.id;
      const body = await readBody(req);
      const data = JSON.parse(body);
      await writeUserData(dataUserId, data);
      sendJSON(res, 200, { ok: true });
      return;
    }

    // ---- PAGES ----
    // Landing
    if (url === '/' || url === '') {
      serveFile(res, FILES.landing);
      return;
    }

    // Static files (images)
    if (url.match(/\.(png|jpg|jpeg|svg|ico|webp)$/)) {
      const filePath = path.join(__dirname, 'public', url);
      const ext = path.extname(url).slice(1);
      const mimeTypes = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', svg:'image/svg+xml', ico:'image/x-icon', webp:'image/webp' };
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
        res.end(data);
      });
      return;
    }

    // Legal
    if (url.startsWith('/legal')) {
      serveFile(res, FILES.legal);
      return;
    }

    // Login/Register
    if (url === '/login' || url === '/register') {
      const user = await getSessionUser(req);
      if (user) { redirect(res, '/app'); return; }
      serveFile(res, FILES.auth);
      return;
    }

    // CRM App (protected)
    if (url === '/app') {
      const user = await getSessionUser(req);
      if (!user) { redirect(res, '/login'); return; }
      if (!user.hasAccess) { redirect(res, '/login?error=expired'); return; }
      serveFile(res, FILES.app);
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404</h1><p>Сторінку не знайдено. <a href="/">На головну</a></p>');

  } catch (e) {
    console.error('Request error:', e.message);
    sendJSON(res, 500, { error: 'Server error' });
  }
});

// ==================== START ====================
async function start() {
  await initDB();
  server.listen(PORT, () => {
    console.log(`LipoLand system running at ${BASE_URL}`);
    console.log(`Database: ${DATABASE_URL ? 'PostgreSQL' : 'local file'}`);
    console.log(`Google OAuth: ${GOOGLE_CLIENT_ID ? 'configured' : 'not configured'}`);
    console.log(`Admin email: ${ADMIN_EMAIL}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
