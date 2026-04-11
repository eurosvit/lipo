const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3999;
const LANDING_FILE = path.join(__dirname, 'landing.html');
const APP_FILE = path.join(__dirname, 'index.html');
const DB_FILE = path.join(__dirname, 'data.json');
const DATABASE_URL = process.env.DATABASE_URL;

// ==================== DATABASE ====================
let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

async function initDB() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      id TEXT PRIMARY KEY DEFAULT 'main',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Ensure row exists
  await pool.query(`
    INSERT INTO app_data (id, data) VALUES ('main', '{}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `);
  console.log('PostgreSQL connected');
}

// ==================== READ/WRITE ====================
async function readDB() {
  if (pool) {
    const res = await pool.query("SELECT data FROM app_data WHERE id = 'main'");
    return res.rows.length ? res.rows[0].data : null;
  }
  // Fallback: local file
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function writeDB(data) {
  if (pool) {
    await pool.query(
      "UPDATE app_data SET data = $1, updated_at = NOW() WHERE id = 'main'",
      [JSON.stringify(data)]
    );
    return;
  }
  // Fallback: local file
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
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
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

// ==================== SERVER ====================
const server = http.createServer(async (req, res) => {
  try {
    // API: GET data
    if (req.method === 'GET' && req.url === '/api/data') {
      const data = await readDB();
      sendJSON(res, 200, data);
      return;
    }

    // API: POST data
    if (req.method === 'POST' && req.url === '/api/data') {
      const body = await readBody(req);
      const data = JSON.parse(body);
      await writeDB(data);
      sendJSON(res, 200, { ok: true });
      return;
    }

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
      res.end();
      return;
    }

    // Serve landing page on /
    if (req.url === '/' || req.url === '') {
      fs.readFile(LANDING_FILE, 'utf8', (err, data) => {
        if (err) { res.writeHead(500); res.end('Error: ' + err.message); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
      return;
    }

    // Serve CRM app on /app
    if (req.url === '/app' || req.url.startsWith('/app?')) {
      fs.readFile(APP_FILE, 'utf8', (err, data) => {
        if (err) { res.writeHead(500); res.end('Error: ' + err.message); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404</h1><p>Сторінку не знайдено. <a href="/">На головну</a></p>');
  } catch (e) {
    console.error('Request error:', e.message);
    sendJSON(res, e.message.includes('Invalid') ? 400 : 500, { error: e.message });
  }
});

// ==================== START ====================
async function start() {
  await initDB();
  server.listen(PORT, () => {
    console.log(`LipoLand system running at http://localhost:${PORT}`);
    console.log(`Database: ${DATABASE_URL ? 'PostgreSQL' : 'local file (data.json)'}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
