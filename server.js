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
const WAYFORPAY_MERCHANT = process.env.WAYFORPAY_MERCHANT || 'lipoland_top';
const WAYFORPAY_SECRET = process.env.WAYFORPAY_SECRET || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'LipoLand <hello@lipoland.top>';

// Subscription plans
const PLANS = {
  month1:  { name: 'Місяць',    months: 1,  price: 250,  label: '250 грн/міс' },
  month6:  { name: '6 місяців', months: 6,  price: 1250, label: '1250 грн (≈208 грн/міс)' },
  month12: { name: '12 місяців', months: 12, price: 2200, label: '2200 грн (≈183 грн/міс)' }
};

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

  // Notification preferences
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_prefs (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      email_welcome BOOLEAN NOT NULL DEFAULT true,
      email_trial_reminder BOOLEAN NOT NULL DEFAULT true,
      email_trial_expired BOOLEAN NOT NULL DEFAULT true,
      email_subscription_reminder BOOLEAN NOT NULL DEFAULT true,
      email_payment_confirm BOOLEAN NOT NULL DEFAULT true,
      email_material_alert BOOLEAN NOT NULL DEFAULT false,
      email_stock_alert BOOLEAN NOT NULL DEFAULT false,
      telegram_enabled BOOLEAN NOT NULL DEFAULT false,
      telegram_chat_id TEXT,
      telegram_material_alert BOOLEAN NOT NULL DEFAULT false,
      telegram_stock_alert BOOLEAN NOT NULL DEFAULT false,
      telegram_order_alert BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Sent emails log (to avoid duplicate sends)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_log (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      email_type TEXT NOT NULL,
      sent_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS email_log_daily_unique
    ON email_log (user_id, email_type, (sent_at::date))
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

// ==================== EMAIL SERVICE (Resend) ====================
const https = require('https');

function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) {
    console.log('[Email] No RESEND_API_KEY, skipping email to', to);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      from: EMAIL_FROM,
      to: [to],
      subject: subject,
      html: html
    });
    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('[Email] Sent to', to, ':', subject);
          resolve(body);
        } else {
          console.error('[Email] Error:', res.statusCode, body);
          resolve(); // don't fail registration if email fails
        }
      });
    });
    req.on('error', (e) => {
      console.error('[Email] Request error:', e.message);
      resolve(); // don't fail registration
    });
    req.write(data);
    req.end();
  });
}

function emailTemplate(content) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F8F5FF;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
  <div style="text-align:center;padding:24px 0;">
    <img src="${BASE_URL}/favicon.png" alt="LipoLand" style="width:40px;height:40px;border-radius:50%;vertical-align:middle;margin-right:8px;"><span style="font-size:28px;font-weight:800;color:#7B1FA2;">LipoLand</span>
  </div>
  <div style="background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 2px 12px rgba(123,31,162,0.08);border:1px solid #E0D8E8;">
    ${content}
  </div>
  <div style="text-align:center;padding:20px;font-size:12px;color:#757575;">
    <p>LipoLand — система управління виробництвом липучкових книжок</p>
    <p><a href="${BASE_URL}" style="color:#7B1FA2;">lipoland.top</a></p>
  </div>
</div>
</body></html>`;
}

function sendWelcomeEmail(name, email, trialDays) {
  const subject = '🎉 Ласкаво просимо до LipoLand!';
  const html = emailTemplate(`
    <h2 style="color:#4A148C;margin:0 0 16px;font-size:22px;">Вітаємо, ${name}! 👋</h2>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Дякуємо за реєстрацію в <strong>LipoLand</strong> — першій спеціалізованій CRM-системі для майстринь липучкових книжок в Україні!
    </p>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">
      У вас є <strong style="color:#7B1FA2;">${trialDays} днів безкоштовного</strong> пробного періоду. За цей час ви зможете повністю оцінити всі можливості системи.
    </p>

    <div style="background:#F3E5F5;border-radius:10px;padding:20px;margin:20px 0;">
      <h3 style="color:#4A148C;margin:0 0 12px;font-size:16px;">📋 З чого почати?</h3>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:6px 0;font-size:14px;color:#2d2d2d;">1️⃣</td><td style="padding:6px 8px;font-size:14px;color:#2d2d2d;"><strong>Матеріали</strong> — додайте ліпучки, папір, плівку та інші матеріали</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;color:#2d2d2d;">2️⃣</td><td style="padding:6px 8px;font-size:14px;color:#2d2d2d;"><strong>Продукція</strong> — створіть каталог ваших ігор</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;color:#2d2d2d;">3️⃣</td><td style="padding:6px 8px;font-size:14px;color:#2d2d2d;"><strong>Собівартість</strong> — заповніть склад виробу для автоматичного розрахунку</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;color:#2d2d2d;">4️⃣</td><td style="padding:6px 8px;font-size:14px;color:#2d2d2d;"><strong>Замовлення</strong> — ведіть облік замовлень та виробництва</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;color:#2d2d2d;">5️⃣</td><td style="padding:6px 8px;font-size:14px;color:#2d2d2d;"><strong>Налаштування</strong> — налаштуйте принтер, ставку майстра, підключіть майстрів</td></tr>
      </table>
    </div>

    <div style="text-align:center;margin:24px 0 8px;">
      <a href="${BASE_URL}/app" style="display:inline-block;background:linear-gradient(135deg,#4A148C,#7B1FA2);color:#fff;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:700;font-size:16px;">Перейти до LipoLand →</a>
    </div>

    <p style="color:#757575;font-size:13px;text-align:center;margin:16px 0 0;">
      Якщо у вас є питання — напишіть нам у відповідь на цей лист 💜
    </p>
  `);
  return sendEmail(email, subject, html);
}

function sendTrialReminderEmail(name, email, daysLeft) {
  const subject = `⏰ ${name}, залишилось ${daysLeft} днів пробного періоду`;
  const html = emailTemplate(`
    <h2 style="color:#4A148C;margin:0 0 16px;font-size:22px;">⏰ Пробний період закінчується</h2>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Привіт, <strong>${name}</strong>! У вас залишилось <strong style="color:#F9A825;">${daysLeft} днів</strong> безкоштовного пробного періоду в LipoLand.
    </p>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Після закінчення пробного періоду доступ до системи буде обмежено. Оформіть підписку, щоб продовжити користуватися всіма можливостями.
    </p>
    <div style="background:#FFF8E1;border-radius:10px;padding:20px;margin:20px 0;text-align:center;">
      <p style="margin:0 0 8px;font-size:14px;color:#2d2d2d;">Тарифи від</p>
      <p style="margin:0;font-size:32px;font-weight:800;color:#7B1FA2;">183 грн/міс</p>
      <p style="margin:4px 0 0;font-size:13px;color:#757575;">при оплаті за 12 місяців</p>
    </div>
    <div style="text-align:center;margin:24px 0 8px;">
      <a href="${BASE_URL}/app" style="display:inline-block;background:linear-gradient(135deg,#4A148C,#7B1FA2);color:#fff;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:700;font-size:16px;">Оформити підписку →</a>
    </div>
  `);
  return sendEmail(email, subject, html);
}

function sendTrialExpiredEmail(name, email) {
  const subject = '🚨 Пробний період LipoLand закінчився';
  const html = emailTemplate(`
    <h2 style="color:#D32F2F;margin:0 0 16px;font-size:22px;">Пробний період завершено</h2>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Привіт, <strong>${name}</strong>. Ваш безкоштовний пробний період в LipoLand завершився.
    </p>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Ваші дані збережено — вони нікуди не зникнуть! Оформіть підписку і продовжуйте працювати з того місця, де зупинились.
    </p>
    <div style="background:#F3E5F5;border-radius:10px;padding:20px;margin:20px 0;">
      <table style="width:100%;border-collapse:collapse;text-align:center;">
        <tr>
          <td style="padding:8px;"><strong style="font-size:18px;color:#4A148C;">250 грн</strong><br><span style="font-size:12px;color:#757575;">1 місяць</span></td>
          <td style="padding:8px;border-left:1px solid #E0D8E8;border-right:1px solid #E0D8E8;"><strong style="font-size:18px;color:#4A148C;">1 250 грн</strong><br><span style="font-size:12px;color:#757575;">6 місяців (-17%)</span></td>
          <td style="padding:8px;"><strong style="font-size:18px;color:#4A148C;">2 200 грн</strong><br><span style="font-size:12px;color:#757575;">12 місяців (-27%)</span></td>
        </tr>
      </table>
    </div>
    <div style="text-align:center;margin:24px 0 8px;">
      <a href="${BASE_URL}/app" style="display:inline-block;background:linear-gradient(135deg,#D32F2F,#E53935);color:#fff;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:700;font-size:16px;">Оформити підписку →</a>
    </div>
    <p style="color:#757575;font-size:13px;text-align:center;margin:16px 0 0;">
      Якщо у вас є питання — напишіть нам у відповідь на цей лист 💜
    </p>
  `);
  return sendEmail(email, subject, html);
}

function sendPaymentConfirmEmail(name, email, planName, amount, endsAt) {
  const endDate = new Date(endsAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
  const subject = '💳 Підписка LipoLand PRO активована!';
  const html = emailTemplate(`
    <h2 style="color:#2E7D32;margin:0 0 16px;font-size:22px;">✅ Оплата пройшла успішно!</h2>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Привіт, <strong>${name}</strong>! Дякуємо за оплату підписки LipoLand PRO.
    </p>
    <div style="background:#E8F5E9;border-radius:10px;padding:20px;margin:20px 0;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:6px 0;font-size:14px;color:#2d2d2d;">📋 Тариф:</td><td style="padding:6px 0;font-size:14px;font-weight:700;text-align:right;">${planName}</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;color:#2d2d2d;">💰 Сума:</td><td style="padding:6px 0;font-size:14px;font-weight:700;text-align:right;">${amount} грн</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;color:#2d2d2d;">📅 Діє до:</td><td style="padding:6px 0;font-size:14px;font-weight:700;text-align:right;">${endDate}</td></tr>
      </table>
    </div>
    <div style="text-align:center;margin:24px 0 8px;">
      <a href="${BASE_URL}/app" style="display:inline-block;background:linear-gradient(135deg,#2E7D32,#43A047);color:#fff;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:700;font-size:16px;">Продовжити роботу →</a>
    </div>
    <p style="color:#757575;font-size:13px;text-align:center;margin:16px 0 0;">
      Приємного користування! 💜
    </p>
  `);
  return sendEmail(email, subject, html);
}

function sendSubscriptionReminderEmail(name, email, daysLeft, endsAt) {
  const endDate = new Date(endsAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
  const subject = `⏰ ${name}, підписка закінчується через ${daysLeft} день`;
  const html = emailTemplate(`
    <h2 style="color:#4A148C;margin:0 0 16px;font-size:22px;">📅 Підписка скоро закінчується</h2>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Привіт, <strong>${name}</strong>! Ваша підписка LipoLand PRO діє до <strong>${endDate}</strong> — це через <strong style="color:#F9A825;">${daysLeft} день</strong>.
    </p>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Подовжте підписку, щоб не втратити доступ до системи. Ваші дані збережені — просто оформіть новий період.
    </p>
    <div style="text-align:center;margin:24px 0 8px;">
      <a href="${BASE_URL}/app" style="display:inline-block;background:linear-gradient(135deg,#4A148C,#7B1FA2);color:#fff;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:700;font-size:16px;">Подовжити підписку →</a>
    </div>
  `);
  return sendEmail(email, subject, html);
}

function sendPromoWelcomeEmail(name, email, trialDays, promoCode, bonusDays) {
  const subject = '🎁 Промокод активовано — додаткові дні в LipoLand!';
  const html = emailTemplate(`
    <h2 style="color:#4A148C;margin:0 0 16px;font-size:22px;">🎁 Промокод активовано!</h2>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Привіт, <strong>${name}</strong>! Ви зареєструвались з промокодом <strong style="color:#7B1FA2;">${promoCode}</strong>.
    </p>
    <div style="background:#E8F5E9;border-radius:10px;padding:20px;margin:20px 0;text-align:center;">
      <p style="margin:0 0 4px;font-size:14px;color:#2d2d2d;">Ваш пробний період:</p>
      <p style="margin:0;font-size:36px;font-weight:800;color:#2E7D32;">${trialDays} днів</p>
      <p style="margin:4px 0 0;font-size:13px;color:#757575;">Стандартний ${trialDays - bonusDays} + бонус ${bonusDays} днів 🎉</p>
    </div>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Використовуйте цей час на повну — додайте матеріали, створіть ігри, налаштуйте собівартість.
    </p>
    <div style="text-align:center;margin:24px 0 8px;">
      <a href="${BASE_URL}/app" style="display:inline-block;background:linear-gradient(135deg,#4A148C,#7B1FA2);color:#fff;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:700;font-size:16px;">Перейти до LipoLand →</a>
    </div>
  `);
  return sendEmail(email, subject, html);
}

function sendAccountDeletedEmail(name, email) {
  const subject = '🗑 Акаунт LipoLand видалено';
  const html = emailTemplate(`
    <h2 style="color:#D32F2F;margin:0 0 16px;font-size:22px;">Акаунт видалено</h2>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Привіт, <strong>${name}</strong>. Ваш акаунт та всі пов'язані дані були повністю видалені з LipoLand.
    </p>
    <div style="background:#FFF3E0;border-radius:10px;padding:20px;margin:20px 0;">
      <p style="margin:0;font-size:14px;color:#2d2d2d;line-height:1.6;">
        <strong>Що було видалено:</strong><br>
        • Профіль та налаштування<br>
        • Всі матеріали, товари, замовлення<br>
        • Історія виробництва та зарплат<br>
        • Підключені майстри та запрошення
      </p>
    </div>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Ця дія незворотна. Якщо ви передумаєте — ви завжди можете створити новий акаунт.
    </p>
    <p style="color:#757575;font-size:13px;margin:16px 0 0;">
      Якщо ви не видаляли акаунт — терміново напишіть нам у відповідь на цей лист.
    </p>
  `);
  return sendEmail(email, subject, html);
}

function sendMaterialAlertEmail(name, email, materials) {
  const rows = materials.map(m =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;">${m.name}</td><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:center;color:#D32F2F;font-weight:700;">${m.qty} ${m.unit}</td><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:center;">${m.min} ${m.unit}</td></tr>`
  ).join('');
  const subject = `⚠️ ${materials.length} матеріал(ів) закінчується — LipoLand`;
  const html = emailTemplate(`
    <h2 style="color:#F9A825;margin:0 0 16px;font-size:22px;">⚠️ Матеріали закінчуються</h2>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Привіт, <strong>${name}</strong>! У вас ${materials.length} матеріал(ів) нижче мінімального запасу:
    </p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr style="background:#F3E5F5;"><th style="padding:8px 12px;text-align:left;font-size:13px;">Матеріал</th><th style="padding:8px 12px;text-align:center;font-size:13px;">Залишок</th><th style="padding:8px 12px;text-align:center;font-size:13px;">Мінімум</th></tr>
      ${rows}
    </table>
    <div style="text-align:center;margin:24px 0 8px;">
      <a href="${BASE_URL}/app" style="display:inline-block;background:linear-gradient(135deg,#4A148C,#7B1FA2);color:#fff;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:700;font-size:16px;">Переглянути матеріали →</a>
    </div>
  `);
  return sendEmail(email, subject, html);
}

function sendWorkerInviteEmail(workerEmail, ownerName) {
  const subject = `🤝 ${ownerName} запрошує вас до LipoLand`;
  const html = emailTemplate(`
    <h2 style="color:#4A148C;margin:0 0 16px;font-size:22px;">Запрошення до LipoLand</h2>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">
      <strong>${ownerName}</strong> запрошує вас приєднатися як майстер до системи LipoLand.
    </p>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Після реєстрації ви зможете бачити замовлення, виробництво та інші дані, до яких вам надано доступ.
    </p>
    <div style="text-align:center;margin:24px 0 8px;">
      <a href="${BASE_URL}/auth" style="display:inline-block;background:linear-gradient(135deg,#4A148C,#7B1FA2);color:#fff;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:700;font-size:16px;">Зареєструватися →</a>
    </div>
    <p style="color:#757575;font-size:13px;text-align:center;margin:16px 0 0;">
      Зареєструйтесь з email <strong>${workerEmail}</strong>, щоб автоматично підключитися.
    </p>
  `);
  return sendEmail(workerEmail, subject, html);
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

    // ---- EMAIL PREVIEW (admin only, remove in production) ----
    if (req.method === 'GET' && url === '/api/email-preview') {
      const type = query.get('type') || 'welcome';
      let html = '';
      switch(type) {
        case 'welcome': html = emailTemplate(`
    <h2 style="color:#4A148C;margin:0 0 16px;font-size:22px;">Вітаємо, Олена! 👋</h2>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">Дякуємо за реєстрацію в <strong>LipoLand</strong> — першій спеціалізованій CRM-системі для майстринь липучкових книжок в Україні!</p>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">У вас є <strong style="color:#7B1FA2;">30 днів безкоштовного</strong> пробного періоду.</p>
    <div style="background:#F3E5F5;border-radius:10px;padding:20px;margin:20px 0;">
      <h3 style="color:#4A148C;margin:0 0 12px;font-size:16px;">📋 З чого почати?</h3>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:6px 0;font-size:14px;">1️⃣</td><td style="padding:6px 8px;font-size:14px;"><strong>Матеріали</strong> — додайте ліпучки, папір, плівку</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;">2️⃣</td><td style="padding:6px 8px;font-size:14px;"><strong>Продукція</strong> — створіть каталог ігор</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;">3️⃣</td><td style="padding:6px 8px;font-size:14px;"><strong>Собівартість</strong> — заповніть склад виробу</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;">4️⃣</td><td style="padding:6px 8px;font-size:14px;"><strong>Замовлення</strong> — ведіть облік замовлень</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;">5️⃣</td><td style="padding:6px 8px;font-size:14px;"><strong>Налаштування</strong> — принтер, ставка, майстри</td></tr>
      </table>
    </div>
    <div style="text-align:center;margin:24px 0 8px;"><a href="#" style="display:inline-block;background:linear-gradient(135deg,#4A148C,#7B1FA2);color:#fff;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:700;font-size:16px;">Перейти до LipoLand →</a></div>
    <p style="color:#757575;font-size:13px;text-align:center;margin:16px 0 0;">Якщо у вас є питання — напишіть нам 💜</p>
  `); break;
        case 'trial': html = emailTemplate(`
    <h2 style="color:#4A148C;margin:0 0 16px;font-size:22px;">⏰ Пробний період закінчується</h2>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">Привіт, <strong>Олена</strong>! У вас залишилось <strong style="color:#F9A825;">3 дні</strong> безкоштовного пробного періоду.</p>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">Оформіть підписку, щоб продовжити користуватися всіма можливостями.</p>
    <div style="background:#FFF8E1;border-radius:10px;padding:20px;margin:20px 0;text-align:center;">
      <p style="margin:0 0 8px;font-size:14px;">Тарифи від</p>
      <p style="margin:0;font-size:32px;font-weight:800;color:#7B1FA2;">183 грн/міс</p>
      <p style="margin:4px 0 0;font-size:13px;color:#757575;">при оплаті за 12 місяців</p>
    </div>
    <div style="text-align:center;margin:24px 0 8px;"><a href="#" style="display:inline-block;background:linear-gradient(135deg,#4A148C,#7B1FA2);color:#fff;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:700;font-size:16px;">Оформити підписку →</a></div>
  `); break;
        case 'expired': html = emailTemplate(`
    <h2 style="color:#D32F2F;margin:0 0 16px;font-size:22px;">Пробний період завершено</h2>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">Привіт, <strong>Олена</strong>. Ваш безкоштовний пробний період завершився.</p>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">Ваші дані збережено — вони нікуди не зникнуть!</p>
    <div style="background:#F3E5F5;border-radius:10px;padding:20px;margin:20px 0;">
      <table style="width:100%;border-collapse:collapse;text-align:center;">
        <tr>
          <td style="padding:8px;"><strong style="font-size:18px;color:#4A148C;">250 грн</strong><br><span style="font-size:12px;color:#757575;">1 місяць</span></td>
          <td style="padding:8px;border-left:1px solid #E0D8E8;border-right:1px solid #E0D8E8;"><strong style="font-size:18px;color:#4A148C;">1 250 грн</strong><br><span style="font-size:12px;color:#757575;">6 місяців (-17%)</span></td>
          <td style="padding:8px;"><strong style="font-size:18px;color:#4A148C;">2 200 грн</strong><br><span style="font-size:12px;color:#757575;">12 місяців (-27%)</span></td>
        </tr>
      </table>
    </div>
    <div style="text-align:center;margin:24px 0 8px;"><a href="#" style="display:inline-block;background:linear-gradient(135deg,#D32F2F,#E53935);color:#fff;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:700;font-size:16px;">Оформити підписку →</a></div>
  `); break;
        case 'payment': html = emailTemplate(`
    <h2 style="color:#2E7D32;margin:0 0 16px;font-size:22px;">✅ Оплата пройшла успішно!</h2>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">Привіт, <strong>Олена</strong>! Дякуємо за оплату підписки LipoLand PRO.</p>
    <div style="background:#E8F5E9;border-radius:10px;padding:20px;margin:20px 0;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:6px 0;font-size:14px;">📋 Тариф:</td><td style="padding:6px 0;font-size:14px;font-weight:700;text-align:right;">6 місяців</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;">💰 Сума:</td><td style="padding:6px 0;font-size:14px;font-weight:700;text-align:right;">1 250 грн</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;">📅 Діє до:</td><td style="padding:6px 0;font-size:14px;font-weight:700;text-align:right;">12 жовтня 2026</td></tr>
      </table>
    </div>
    <div style="text-align:center;margin:24px 0 8px;"><a href="#" style="display:inline-block;background:linear-gradient(135deg,#2E7D32,#43A047);color:#fff;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:700;font-size:16px;">Продовжити роботу →</a></div>
  `); break;
        case 'promo': html = emailTemplate(`
    <h2 style="color:#4A148C;margin:0 0 16px;font-size:22px;">🎁 Промокод активовано!</h2>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">Привіт, <strong>Олена</strong>! Ви зареєструвались з промокодом <strong style="color:#7B1FA2;">WELCOME50</strong>.</p>
    <div style="background:#E8F5E9;border-radius:10px;padding:20px;margin:20px 0;text-align:center;">
      <p style="margin:0 0 4px;font-size:14px;">Ваш пробний період:</p>
      <p style="margin:0;font-size:36px;font-weight:800;color:#2E7D32;">60 днів</p>
      <p style="margin:4px 0 0;font-size:13px;color:#757575;">Стандартний 30 + бонус 30 днів 🎉</p>
    </div>
    <div style="text-align:center;margin:24px 0 8px;"><a href="#" style="display:inline-block;background:linear-gradient(135deg,#4A148C,#7B1FA2);color:#fff;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:700;font-size:16px;">Перейти до LipoLand →</a></div>
  `); break;
        case 'deleted': html = emailTemplate(`
    <h2 style="color:#D32F2F;margin:0 0 16px;font-size:22px;">Акаунт видалено</h2>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">Привіт, <strong>Олена</strong>. Ваш акаунт та всі пов'язані дані були повністю видалені.</p>
    <div style="background:#FFF3E0;border-radius:10px;padding:20px;margin:20px 0;">
      <p style="margin:0;font-size:14px;line-height:1.6;"><strong>Що було видалено:</strong><br>• Профіль та налаштування<br>• Всі матеріали, товари, замовлення<br>• Історія виробництва та зарплат<br>• Підключені майстри та запрошення</p>
    </div>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">Ця дія незворотна. Якщо передумаєте — створіть новий акаунт.</p>
    <p style="color:#757575;font-size:13px;margin:16px 0 0;">Якщо ви не видаляли акаунт — терміново напишіть нам.</p>
  `); break;
        case 'material': html = emailTemplate(`
    <h2 style="color:#F9A825;margin:0 0 16px;font-size:22px;">⚠️ Матеріали закінчуються</h2>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">Привіт, <strong>Олена</strong>! У вас 3 матеріал(ів) нижче мінімального запасу:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr style="background:#F3E5F5;"><th style="padding:8px 12px;text-align:left;font-size:13px;">Матеріал</th><th style="padding:8px 12px;text-align:center;font-size:13px;">Залишок</th><th style="padding:8px 12px;text-align:center;font-size:13px;">Мінімум</th></tr>
      <tr><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">Ліпучка біла 25мм</td><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center;color:#D32F2F;font-weight:700;">2 м.п.</td><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center;">10 м.п.</td></tr>
      <tr><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">Папір 180г глянець</td><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center;color:#D32F2F;font-weight:700;">5 арк.</td><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center;">20 арк.</td></tr>
      <tr><td style="padding:8px 12px;">Плівка для ламінації</td><td style="padding:8px 12px;text-align:center;color:#D32F2F;font-weight:700;">0 м.п.</td><td style="padding:8px 12px;text-align:center;">5 м.п.</td></tr>
    </table>
    <div style="text-align:center;margin:24px 0 8px;"><a href="#" style="display:inline-block;background:linear-gradient(135deg,#4A148C,#7B1FA2);color:#fff;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:700;font-size:16px;">Переглянути матеріали →</a></div>
  `); break;
        case 'invite': html = emailTemplate(`
    <h2 style="color:#4A148C;margin:0 0 16px;font-size:22px;">Запрошення до LipoLand</h2>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;"><strong>Олена Майстренко</strong> запрошує вас приєднатися як майстер до системи LipoLand.</p>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">Після реєстрації ви зможете бачити замовлення, виробництво та інші дані.</p>
    <div style="text-align:center;margin:24px 0 8px;"><a href="#" style="display:inline-block;background:linear-gradient(135deg,#4A148C,#7B1FA2);color:#fff;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:700;font-size:16px;">Зареєструватися →</a></div>
    <p style="color:#757575;font-size:13px;text-align:center;margin:16px 0 0;">Зареєструйтесь з email <strong>maria@example.com</strong>, щоб автоматично підключитися.</p>
  `); break;
        case 'sub-reminder': html = emailTemplate(`
    <h2 style="color:#4A148C;margin:0 0 16px;font-size:22px;">📅 Підписка скоро закінчується</h2>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">Привіт, <strong>Олена</strong>! Ваша підписка LipoLand PRO діє до <strong>13 квітня 2026</strong> — це через <strong style="color:#F9A825;">1 день</strong>.</p>
    <p style="color:#2d2d2d;font-size:15px;line-height:1.6;margin:0 0 16px;">Подовжте підписку, щоб не втратити доступ до системи.</p>
    <div style="text-align:center;margin:24px 0 8px;"><a href="#" style="display:inline-block;background:linear-gradient(135deg,#4A148C,#7B1FA2);color:#fff;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:700;font-size:16px;">Подовжити підписку →</a></div>
  `); break;
        default: html = '<h1>Types: welcome, trial, expired, payment, promo, deleted, material, invite, sub-reminder</h1>';
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
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

      // Create default notification preferences
      await pool.query(
        "INSERT INTO notification_prefs (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
        [userId]
      );

      await createSession(res, userId);
      // Send welcome email (async, don't wait)
      if (bonusDays > 0 && promo) {
        sendPromoWelcomeEmail(name, email.toLowerCase(), TRIAL_DAYS + bonusDays, promo.toUpperCase(), bonusDays).catch(() => {});
      } else {
        sendWelcomeEmail(name, email.toLowerCase(), TRIAL_DAYS + bonusDays).catch(() => {});
      }
      sendJSON(res, 200, { ok: true, isNewUser: true });
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
        // Create default notification preferences
        await pool.query(
          "INSERT INTO notification_prefs (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
          [userId]
        );
        // Send welcome email for new Google users
        sendWelcomeEmail(googleUser.name || '', googleUser.email.toLowerCase(), TRIAL_DAYS).catch(() => {});
      }

      await createSession(res, userId);
      const isNew = !result.rows.length;
      redirect(res, isNew ? '/app?welcome=1' : '/app');
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
      // Save info before deleting
      const deletedName = user.name || '';
      const deletedEmail = user.email || '';
      // Delete user data, sessions, prefs, then user
      await pool.query("DELETE FROM notification_prefs WHERE user_id = $1", [user.id]);
      await pool.query("DELETE FROM email_log WHERE user_id = $1", [user.id]);
      await pool.query("DELETE FROM app_data WHERE id = $1", [user.id]);
      await pool.query("DELETE FROM sessions WHERE user_id = $1", [user.id]);
      await pool.query("DELETE FROM worker_links WHERE owner_id = $1 OR worker_id = $1", [user.id]);
      await pool.query("DELETE FROM worker_invites WHERE owner_id = $1", [user.id]);
      await pool.query("DELETE FROM users WHERE id = $1", [user.id]);
      clearSessionCookie(res);
      // Send deletion confirmation email
      sendAccountDeletedEmail(deletedName, deletedEmail).catch(() => {});
      sendJSON(res, 200, { ok: true });
      return;
    }

    // ---- NOTIFICATIONS: Get preferences ----
    if (req.method === 'GET' && url === '/api/notifications/prefs') {
      const user = await getSessionUser(req);
      if (!user) { sendJSON(res, 401, { error: 'Not authenticated' }); return; }
      if (pool) {
        const r = await pool.query("SELECT * FROM notification_prefs WHERE user_id = $1", [user.id]);
        if (r.rows.length) {
          sendJSON(res, 200, r.rows[0]);
        } else {
          await pool.query("INSERT INTO notification_prefs (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [user.id]);
          const r2 = await pool.query("SELECT * FROM notification_prefs WHERE user_id = $1", [user.id]);
          sendJSON(res, 200, r2.rows[0] || {});
        }
      } else {
        sendJSON(res, 200, {});
      }
      return;
    }

    // ---- NOTIFICATIONS: Update preferences ----
    if (req.method === 'POST' && url === '/api/notifications/prefs') {
      const user = await getSessionUser(req);
      if (!user) { sendJSON(res, 401, { error: 'Not authenticated' }); return; }
      const body = JSON.parse(await readBody(req));
      if (pool) {
        const fields = [
          'email_welcome', 'email_trial_reminder', 'email_trial_expired',
          'email_subscription_reminder', 'email_payment_confirm',
          'email_material_alert', 'email_stock_alert',
          'telegram_enabled', 'telegram_material_alert', 'telegram_stock_alert', 'telegram_order_alert'
        ];
        const updates = [];
        const values = [user.id];
        let idx = 2;
        for (const f of fields) {
          if (body[f] !== undefined) {
            updates.push(`${f} = $${idx}`);
            values.push(body[f]);
            idx++;
          }
        }
        if (updates.length) {
          await pool.query(
            `INSERT INTO notification_prefs (user_id) VALUES ($1) ON CONFLICT (user_id) DO UPDATE SET ${updates.join(', ')}, updated_at = NOW()`,
            values
          );
        }
        sendJSON(res, 200, { ok: true });
      } else {
        sendJSON(res, 200, { ok: true });
      }
      return;
    }

    // ---- NOTIFICATIONS: Link Telegram ----
    if (req.method === 'POST' && url === '/api/notifications/telegram-link') {
      const user = await getSessionUser(req);
      if (!user) { sendJSON(res, 401, { error: 'Not authenticated' }); return; }
      const body = JSON.parse(await readBody(req));
      if (body.chatId && pool) {
        await pool.query(
          `INSERT INTO notification_prefs (user_id, telegram_chat_id, telegram_enabled) VALUES ($1, $2, true)
           ON CONFLICT (user_id) DO UPDATE SET telegram_chat_id = $2, telegram_enabled = true, updated_at = NOW()`,
          [user.id, body.chatId]
        );
        sendJSON(res, 200, { ok: true });
      } else {
        sendJSON(res, 400, { error: 'chatId required' });
      }
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
        const inviteUrl = `${BASE_URL}/auth?invite=${token}`;
        // Send invitation email
        sendWorkerInviteEmail(email.toLowerCase(), user.name || 'Власник').catch(() => {});
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

    // ---- PAYMENT: Create WayForPay payment ----
    if (req.method === 'POST' && url === '/api/payment/create') {
      const user = await getSessionUser(req);
      if (!user) { sendJSON(res, 401, { error: 'Not authenticated' }); return; }
      if (!WAYFORPAY_SECRET) { sendJSON(res, 400, { error: 'Оплата тимчасово недоступна' }); return; }

      const body = JSON.parse(await readBody(req));
      const plan = PLANS[body.plan];
      if (!plan) { sendJSON(res, 400, { error: 'Невірний тариф' }); return; }

      const orderId = `LIPO_${user.id}_${Date.now()}`;
      const orderDate = Math.floor(Date.now() / 1000);
      const productName = `LipoLand підписка: ${plan.name}`;
      const productPrice = plan.price;

      // WayForPay signature: merchantAccount;merchantDomainName;orderReference;orderDate;amount;currency;productName;productCount;productPrice
      const signString = [
        WAYFORPAY_MERCHANT, 'lipoland.top', orderId, orderDate,
        productPrice, 'UAH', productName, 1, productPrice
      ].join(';');
      const signature = crypto.createHmac('md5', WAYFORPAY_SECRET).update(signString).digest('hex');

      // Save pending payment
      if (pool) {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS payments (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            order_id TEXT UNIQUE NOT NULL,
            plan TEXT NOT NULL,
            amount INTEGER NOT NULL,
            months INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            paid_at TIMESTAMPTZ
          )
        `);
        await pool.query(
          "INSERT INTO payments (id, user_id, order_id, plan, amount, months, status) VALUES ($1, $2, $3, $4, $5, $6, 'pending')",
          [generateId(), user.id, orderId, body.plan, productPrice, plan.months]
        );
      }

      sendJSON(res, 200, {
        merchantAccount: WAYFORPAY_MERCHANT,
        merchantDomainName: 'lipoland.top',
        merchantSignature: signature,
        orderReference: orderId,
        orderDate: orderDate,
        amount: productPrice,
        currency: 'UAH',
        productName: [productName],
        productCount: [1],
        productPrice: [productPrice],
        returnUrl: `${BASE_URL}/app?payment=success`,
        serviceUrl: `${BASE_URL}/api/payment/callback`
      });
      return;
    }

    // ---- PAYMENT: WayForPay callback (server-to-server) ----
    if (req.method === 'POST' && url === '/api/payment/callback') {
      try {
        const body = JSON.parse(await readBody(req));
        const { merchantSignature, orderReference, transactionStatus, reasonCode } = body;

        if (transactionStatus === 'Approved' && pool) {
          // Verify signature
          const checkString = [
            body.merchantAccount, orderReference, body.amount, body.currency,
            body.authCode, body.cardPan, transactionStatus, reasonCode
          ].join(';');
          const expectedSign = crypto.createHmac('md5', WAYFORPAY_SECRET).update(checkString).digest('hex');

          if (expectedSign === merchantSignature) {
            // Find payment and activate subscription
            const paymentRes = await pool.query("SELECT * FROM payments WHERE order_id = $1 AND status = 'pending'", [orderReference]);
            if (paymentRes.rows.length) {
              const payment = paymentRes.rows[0];
              const now = new Date();
              // Extend subscription from current end or from now
              const userRes = await pool.query("SELECT subscription_ends_at FROM users WHERE id = $1", [payment.user_id]);
              let startDate = now;
              if (userRes.rows.length && userRes.rows[0].subscription_ends_at) {
                const currentEnd = new Date(userRes.rows[0].subscription_ends_at);
                if (currentEnd > now) startDate = currentEnd;
              }
              const newEnd = new Date(startDate);
              newEnd.setMonth(newEnd.getMonth() + payment.months);

              await pool.query("UPDATE users SET subscription_ends_at = $1 WHERE id = $2", [newEnd, payment.user_id]);
              await pool.query("UPDATE payments SET status = 'paid', paid_at = NOW() WHERE id = $1", [payment.id]);
              console.log(`Payment confirmed: ${orderReference}, user ${payment.user_id}, until ${newEnd.toISOString()}`);

              // Send payment confirmation email
              const paidUser = await pool.query("SELECT name, email FROM users WHERE id = $1", [payment.user_id]);
              if (paidUser.rows.length) {
                const pu = paidUser.rows[0];
                const planInfo = Object.values(PLANS).find(p => p.price === payment.amount) || { name: payment.plan };
                sendPaymentConfirmEmail(pu.name, pu.email, planInfo.name || payment.plan, payment.amount, newEnd).catch(() => {});
              }
            }
          }
        }

        // WayForPay expects this response
        const responseTime = Math.floor(Date.now() / 1000);
        const responseSign = crypto.createHmac('md5', WAYFORPAY_SECRET)
          .update([orderReference, 'accept', responseTime].join(';'))
          .digest('hex');

        sendJSON(res, 200, {
          orderReference: orderReference,
          status: 'accept',
          time: responseTime,
          signature: responseSign
        });
      } catch (e) {
        console.error('Payment callback error:', e.message);
        sendJSON(res, 200, { status: 'accept' });
      }
      return;
    }

    // ---- PAYMENT: Check payment status ----
    if (req.method === 'GET' && url === '/api/payment/status') {
      const user = await getSessionUser(req);
      if (!user) { sendJSON(res, 401, { error: 'Not authenticated' }); return; }
      if (pool) {
        const payments = await pool.query(
          "SELECT plan, amount, status, created_at, paid_at FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10",
          [user.id]
        );
        sendJSON(res, 200, { payments: payments.rows });
      } else {
        sendJSON(res, 200, { payments: [] });
      }
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
    if (url === '/login' || url === '/register' || url === '/auth') {
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

// ==================== TRIAL REMINDER CRON ====================
// Helper: check if user opted into email type
async function userWantsEmail(userId, emailType) {
  if (!pool) return true;
  const r = await pool.query(`SELECT ${emailType} FROM notification_prefs WHERE user_id = $1`, [userId]);
  if (!r.rows.length) return true; // default = on
  return r.rows[0][emailType] !== false;
}

// Helper: check if email was already sent today
async function wasEmailSentToday(userId, emailType) {
  if (!pool) return false;
  const r = await pool.query(
    "SELECT 1 FROM email_log WHERE user_id = $1 AND email_type = $2 AND sent_at::date = NOW()::date LIMIT 1",
    [userId, emailType]
  );
  return r.rows.length > 0;
}

async function logEmailSent(userId, emailType) {
  if (!pool) return;
  await pool.query(
    "INSERT INTO email_log (user_id, email_type) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [userId, emailType]
  ).catch(() => {});
}

async function checkTrialReminders() {
  if (!pool || !RESEND_API_KEY) return;
  try {
    // === TRIAL REMINDERS (7 days and 3 days) ===
    const trialUsers = await pool.query(`
      SELECT u.id, u.name, u.email, u.trial_ends_at FROM users u
      WHERE u.role != 'admin'
        AND (u.subscription_ends_at IS NULL OR u.subscription_ends_at < NOW())
        AND u.trial_ends_at > NOW()
        AND u.trial_ends_at <= NOW() + INTERVAL '7 days'
    `);
    for (const u of trialUsers.rows) {
      const days = Math.ceil((new Date(u.trial_ends_at) - new Date()) / (1000*60*60*24));
      const key = `trial_reminder_${days}d`;
      if (days === 7 || days === 3 || days === 1) {
        if (await wasEmailSentToday(u.id, key)) continue;
        if (!(await userWantsEmail(u.id, 'email_trial_reminder'))) continue;
        console.log(`[Cron] Trial reminder: ${u.email}, ${days} days left`);
        await sendTrialReminderEmail(u.name || '', u.email, days);
        await logEmailSent(u.id, key);
      }
    }

    // === TRIAL EXPIRED (today) ===
    const expired = await pool.query(`
      SELECT u.id, u.name, u.email FROM users u
      WHERE u.role != 'admin'
        AND (u.subscription_ends_at IS NULL OR u.subscription_ends_at < NOW())
        AND u.trial_ends_at <= NOW()
        AND u.trial_ends_at > NOW() - INTERVAL '1 day'
    `);
    for (const u of expired.rows) {
      if (await wasEmailSentToday(u.id, 'trial_expired')) continue;
      if (!(await userWantsEmail(u.id, 'email_trial_expired'))) continue;
      console.log(`[Cron] Trial expired: ${u.email}`);
      await sendTrialExpiredEmail(u.name || '', u.email);
      await logEmailSent(u.id, 'trial_expired');
    }

    // === SUBSCRIPTION RENEWAL REMINDER (1 day before) ===
    const subExpiring = await pool.query(`
      SELECT u.id, u.name, u.email, u.subscription_ends_at FROM users u
      WHERE u.role != 'admin'
        AND u.subscription_ends_at > NOW()
        AND u.subscription_ends_at <= NOW() + INTERVAL '1 day'
    `);
    for (const u of subExpiring.rows) {
      if (await wasEmailSentToday(u.id, 'sub_reminder_1d')) continue;
      if (!(await userWantsEmail(u.id, 'email_subscription_reminder'))) continue;
      console.log(`[Cron] Subscription reminder: ${u.email}, 1 day left`);
      await sendSubscriptionReminderEmail(u.name || '', u.email, 1, u.subscription_ends_at);
      await logEmailSent(u.id, 'sub_reminder_1d');
    }

    // === MATERIAL ALERTS (daily check) ===
    const allUsers = await pool.query(`
      SELECT u.id, u.name, u.email FROM users u
      JOIN notification_prefs np ON np.user_id = u.id
      WHERE np.email_material_alert = true AND u.role != 'admin'
    `);
    for (const u of allUsers.rows) {
      if (await wasEmailSentToday(u.id, 'material_alert')) continue;
      // Check user's materials
      const dataRes = await pool.query("SELECT data FROM app_data WHERE id = $1", [u.id]);
      if (!dataRes.rows.length) continue;
      const data = dataRes.rows[0].data;
      if (!data.materials) continue;
      const lowMaterials = data.materials.filter(m => m.min && m.qty <= m.min);
      if (lowMaterials.length > 0) {
        console.log(`[Cron] Material alert: ${u.email}, ${lowMaterials.length} low`);
        await sendMaterialAlertEmail(u.name || '', u.email, lowMaterials);
        await logEmailSent(u.id, 'material_alert');
      }
    }

    console.log(`[Cron] Check completed at ${new Date().toISOString()}`);
  } catch (e) {
    console.error('[Cron] Reminder error:', e.message);
  }
}

// ==================== START ====================
async function start() {
  await initDB();
  server.listen(PORT, () => {
    console.log(`LipoLand system running at ${BASE_URL}`);
    console.log(`Database: ${DATABASE_URL ? 'PostgreSQL' : 'local file'}`);
    console.log(`Google OAuth: ${GOOGLE_CLIENT_ID ? 'configured' : 'not configured'}`);
    console.log(`Resend email: ${RESEND_API_KEY ? 'configured' : 'not configured'}`);
    console.log(`Admin email: ${ADMIN_EMAIL}`);
  });

  // Run trial reminders every 24 hours (check at startup + every 24h)
  if (pool && RESEND_API_KEY) {
    setTimeout(() => checkTrialReminders(), 10000); // 10s after start
    setInterval(() => checkTrialReminders(), 24 * 60 * 60 * 1000); // every 24h
  }
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
