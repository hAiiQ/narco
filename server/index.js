import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import pg from 'pg';
import { newDb } from 'pg-mem';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);

let pool;
let usingMemory = false;

if (process.env.DATABASE_URL) {
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isProduction ? { rejectUnauthorized: false } : undefined,
  });
} else {
  usingMemory = true;
  const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
  memoryDb.public.registerFunction({ name: 'now', returns: 'timestamptz', implementation: () => new Date() });
  const adapter = memoryDb.adapters.createPg();
  pool = new adapter.Pool();
  console.warn('Keine DATABASE_URL gesetzt – Entwicklung läuft mit einer temporären In-Memory-Datenbank.');
}

const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
await pool.query(schema);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      fontSrc: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));

const PgStore = connectPgSimple(session);
app.use(session({
  store: usingMemory ? undefined : new PgStore({ pool, createTableIfMissing: true }),
  name: 'tequilala.sid',
  secret: process.env.SESSION_SECRET || 'local-development-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 14,
  },
}));

app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !isProduction) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Ungültige Anfrage.' });
  } catch {
    return res.status(403).json({ error: 'Ungültige Anfrage.' });
  }
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Zu viele Versuche. Bitte warte kurz.' },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    callback(allowed.includes(file.mimetype) ? null : new Error('Nur JPG, PNG, WebP oder GIF sind erlaubt.'), allowed.includes(file.mimetype));
  },
});

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const intValue = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback;
const optionalInt = (value) => value === null || value === '' || value === undefined ? null : intValue(value, null);
const trimmed = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const icNamePattern = /^[\p{L}][\p{L}\p{M}' -]{1,79}$/u;
const optimizedImageLimit = 650 * 1024;

async function optimizeImage(file) {
  const attempts = [
    { size: 1600, quality: 78 },
    { size: 1400, quality: 70 },
    { size: 1200, quality: 62 },
    { size: 1000, quality: 54 },
  ];
  let smallest = null;
  for (const attempt of attempts) {
    const output = await sharp(file.buffer, { animated: false, limitInputPixels: 40_000_000 })
      .rotate()
      .resize({
        width: attempt.size,
        height: attempt.size,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: attempt.quality, effort: 4, smartSubsample: true })
      .toBuffer();
    if (!smallest || output.length < smallest.length) smallest = output;
    if (output.length <= optimizedImageLimit) break;
  }
  const originalBaseName = path.parse(path.basename(file.originalname)).name || 'bild';
  return {
    buffer: smallest,
    fileName: `${trimmed(originalBaseName, 240)}.webp`,
    mimeType: 'image/webp',
  };
}

function validBirthDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value || date > new Date()) return null;
  return date;
}

function ageFromBirthDate(date) {
  const today = new Date();
  let age = today.getUTCFullYear() - date.getUTCFullYear();
  const beforeBirthday = today.getUTCMonth() < date.getUTCMonth()
    || (today.getUTCMonth() === date.getUTCMonth() && today.getUTCDate() < date.getUTCDate());
  if (beforeBirthday) age -= 1;
  return Math.max(0, age);
}

async function currentUser(userId) {
  if (!userId) return null;
  const { rows } = await pool.query(`
    SELECT u.id, u.username, u.display_name, u.first_name, u.last_name, u.gender,
           u.age, u.birth_date, u.task_area,
           u.about, u.role_id, u.avatar_asset_id,
           u.is_admin, u.is_approved, r.name AS role_name, r.color AS role_color
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = $1
  `, [userId]);
  return rows[0] || null;
}

const requireRole = asyncRoute(async (req, res, next) => {
  const user = await currentUser(req.session.userId);
  if (!user) {
    req.session.userId = null;
    return res.status(401).json({ error: 'Bitte melde dich an.' });
  }
  if (!user.role_id && !user.is_admin) {
    return res.status(403).json({ error: 'Dir wurde noch keine Rolle zugewiesen.', code: 'ROLE_REQUIRED' });
  }
  req.user = user;
  next();
});

const requireAdmin = asyncRoute(async (req, res, next) => {
  const user = await currentUser(req.session.userId);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'Nur für Admins.' });
  req.user = user;
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/register', authLimiter, asyncRoute(async (req, res) => {
  const firstName = trimmed(req.body.firstName, 80);
  const lastName = trimmed(req.body.lastName, 80);
  const displayName = `${firstName} ${lastName}`.trim();
  const username = displayName;
  const email = `account-${randomUUID()}@narco.local`;
  const birthDate = trimmed(req.body.birthDate, 10);
  const parsedBirthDate = validBirthDate(birthDate);
  const gender = String(req.body.gender || '');
  const password = String(req.body.password || '');
  const isMichaelBlack = displayName.toLocaleLowerCase('de-DE') === 'michael black';

  if (!icNamePattern.test(firstName) || !icNamePattern.test(lastName)) {
    return res.status(400).json({ error: 'Bitte gib einen gültigen IC-Vor- und Nachnamen ein.' });
  }
  if (displayName.length > 100) return res.status(400).json({ error: 'Der vollständige IC-Name ist zu lang.' });
  if (!parsedBirthDate) return res.status(400).json({ error: 'Bitte gib ein gültiges IC-Geburtsdatum ein.' });
  if (!['male', 'female'].includes(gender)) return res.status(400).json({ error: 'Bitte wähle männlich oder weiblich.' });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Das Passwort muss mindestens 8 Zeichen haben.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ownerRole = isMichaelBlack ? await client.query("SELECT id FROM roles WHERE name = 'Inhaber' LIMIT 1") : { rows: [] };
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await client.query(`
      INSERT INTO users (username, email, password_hash, display_name, first_name, last_name,
                         gender, birth_date, age, role_id, is_approved, is_admin)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11)
      RETURNING id, username, display_name, is_approved, is_admin
    `, [username, email, passwordHash, displayName, firstName, lastName, gender, birthDate,
      ageFromBirthDate(parsedBirthDate), ownerRole.rows[0]?.id || null, isMichaelBlack]);
    await client.query('COMMIT');
    const createdUser = await currentUser(result.rows[0].id);
    req.session.userId = result.rows[0].id;
    return req.session.save(() => res.status(201).json({ user: createdUser }));
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'Dieser Narco-City-Name ist bereits registriert.' });
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/auth/login', authLimiter, asyncRoute(async (req, res) => {
  const login = trimmed(req.body.login, 160).toLowerCase();
  const password = String(req.body.password || '');
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $1 LIMIT 1', [login]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Anmeldedaten stimmen nicht.' });
  }
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: 'Anmeldung gerade nicht möglich.' });
    req.session.userId = user.id;
    req.session.save(async () => res.json({ user: await currentUser(user.id) }));
  });
}));

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('tequilala.sid');
    res.json({ ok: true });
  });
});

app.get('/api/auth/session', asyncRoute(async (req, res) => {
  const user = await currentUser(req.session.userId);
  if (!user) return res.status(401).json({ user: null });
  res.json({ user });
}));

app.get('/api/assets/:id', requireRole, asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT file_name, mime_type, data FROM assets WHERE id = $1', [intValue(req.params.id)]);
  if (!rows[0]) return res.status(404).end();
  res.set('Content-Type', rows[0].mime_type);
  res.set('Cache-Control', 'private, max-age=86400');
  res.send(Buffer.from(rows[0].data, 'base64'));
}));

app.get('/api/dashboard', requireRole, asyncRoute(async (req, res) => {
  const [staff, pending, inventory, events, finance] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS count FROM users WHERE role_id IS NOT NULL OR is_admin = TRUE'),
    pool.query("SELECT COUNT(*)::int AS count FROM submissions WHERE status = 'pending'"),
    pool.query('SELECT COALESCE(SUM(quantity), 0)::int AS count FROM inventory_items'),
    pool.query('SELECT COUNT(*)::int AS count FROM events WHERE starts_at IS NULL OR starts_at >= NOW()'),
    pool.query('SELECT cash, dirty_cash FROM finance WHERE id = 1'),
  ]);
  res.json({
    staff: Number(staff.rows[0].count),
    pendingSubmissions: Number(pending.rows[0].count),
    inventoryCount: Number(inventory.rows[0].count),
    upcomingEvents: Number(events.rows[0].count),
    finance: finance.rows[0],
  });
}));

app.get('/api/staff', requireRole, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.display_name, u.first_name, u.last_name, u.gender, u.age, u.birth_date,
           u.task_area, u.about, u.avatar_asset_id,
           r.name AS role_name, r.color AS role_color
    FROM users u LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.role_id IS NOT NULL OR u.is_admin = TRUE
    ORDER BY COALESCE(r.priority, -1) DESC, u.display_name ASC
  `);
  res.json({ staff: rows });
}));

app.get('/api/progress', requireRole, asyncRoute(async (_req, res) => {
  const [campaigns, users, totals] = await Promise.all([
    pool.query(`
      SELECT c.*, item.name AS item_name
      FROM contribution_campaigns c
      LEFT JOIN inventory_items item ON item.id = c.inventory_item_id
      WHERE c.starts_at <= NOW()
      ORDER BY CASE WHEN c.ends_at >= NOW() THEN 0 ELSE 1 END,
               c.starts_at DESC, c.created_at DESC
    `),
    pool.query(`
      SELECT u.id, u.display_name, u.avatar_asset_id,
             r.name AS role_name, r.color AS role_color, r.priority
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.role_id IS NOT NULL OR u.is_admin = TRUE
      ORDER BY COALESCE(r.priority, -1) DESC, u.display_name
    `),
    pool.query(`
      SELECT campaign_id, user_id,
             COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END), 0) AS approved_amount,
             COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) AS pending_amount
      FROM submissions
      WHERE campaign_id IS NOT NULL
      GROUP BY campaign_id, user_id
    `),
  ]);
  const totalsByKey = new Map(totals.rows.map((entry) => [
    `${Number(entry.campaign_id)}:${Number(entry.user_id)}`,
    entry,
  ]));
  const progress = campaigns.rows.flatMap((campaign) => users.rows.map((user) => {
    const total = totalsByKey.get(`${Number(campaign.id)}:${Number(user.id)}`);
    return {
      ...user,
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      resource_type: campaign.resource_type,
      item_name: campaign.item_name,
      target_amount: campaign.target_amount,
      starts_at: campaign.starts_at,
      ends_at: campaign.ends_at,
      approved_amount: total?.approved_amount || 0,
      pending_amount: total?.pending_amount || 0,
    };
  }));
  res.json({ campaigns: campaigns.rows, progress });
}));

app.get('/api/submissions', requireRole, asyncRoute(async (req, res) => {
  const admin = Boolean(req.user.is_admin);
  const values = admin ? [] : [req.user.id];
  const where = admin ? '' : 'WHERE s.user_id = $1';
  const { rows } = await pool.query(`
    SELECT s.id, s.amount, s.note, s.status, s.submitted_at, s.reviewed_at,
           s.inventory_item_id, s.campaign_id, u.id AS user_id, u.display_name,
           reviewer.display_name AS reviewer_name, item.name AS item_name,
           c.name AS campaign_name, COALESCE(s.resource_type, c.resource_type) AS resource_type,
           c.target_amount, c.starts_at, c.ends_at
    FROM submissions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN users reviewer ON reviewer.id = s.reviewed_by
    LEFT JOIN inventory_items item ON item.id = s.inventory_item_id
    LEFT JOIN contribution_campaigns c ON c.id = s.campaign_id
    ${where}
    ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.submitted_at DESC
  `, values);
  res.json({ submissions: rows });
}));

app.post('/api/submissions', requireRole, asyncRoute(async (req, res) => {
  const amount = intValue(req.body.amount);
  const campaignId = intValue(req.body.campaignId);
  const note = trimmed(req.body.note, 500);
  if (amount <= 0 || amount > 1000000000) return res.status(400).json({ error: 'Bitte gib eine gültige Menge ein.' });
  const campaign = await pool.query(`
    SELECT c.*, item.name AS item_name
    FROM contribution_campaigns c
    LEFT JOIN inventory_items item ON item.id = c.inventory_item_id
    WHERE c.id = $1 AND c.starts_at <= NOW() AND c.ends_at >= NOW()
  `, [campaignId]);
  if (!campaign.rows[0]) return res.status(400).json({ error: 'Dieser Abgabezeitraum ist nicht aktiv.' });
  if (campaign.rows[0].resource_type === 'item' && !campaign.rows[0].inventory_item_id) {
    return res.status(409).json({ error: 'Dem Abgabezeitraum fehlt der Inventarartikel.' });
  }
  const { rows } = await pool.query(`
    INSERT INTO submissions (user_id, campaign_id, inventory_item_id, resource_type, amount, note)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, campaign_id, inventory_item_id, resource_type, amount, note, status, submitted_at
  `, [req.user.id, campaign.rows[0].id, campaign.rows[0].inventory_item_id,
    campaign.rows[0].resource_type, amount, note]);
  res.status(201).json({ submission: {
    ...rows[0],
    campaign_name: campaign.rows[0].name,
    resource_type: campaign.rows[0].resource_type,
    item_name: campaign.rows[0].item_name,
  } });
}));

app.get('/api/inventory', requireRole, asyncRoute(async (_req, res) => {
  const [items, finance] = await Promise.all([
    pool.query('SELECT * FROM inventory_items ORDER BY name'),
    pool.query('SELECT cash, dirty_cash, updated_at FROM finance WHERE id = 1'),
  ]);
  res.json({ items: items.rows, finance: finance.rows[0] });
}));

app.get('/api/menu', requireRole, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM menu_items ORDER BY available DESC, name');
  res.json({ items: rows });
}));

app.get('/api/events', requireRole, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM events ORDER BY starts_at NULLS LAST, title');
  res.json({ events: rows });
}));

app.get('/api/admin/overview', requireAdmin, asyncRoute(async (_req, res) => {
  const [users, roles, campaigns, submissions, inventory, menu, events, finance] = await Promise.all([
    pool.query(`SELECT u.id, u.username, u.display_name, u.first_name, u.last_name, u.gender,
                       u.age, u.birth_date, u.task_area, u.about,
                       u.role_id, u.avatar_asset_id,
                       u.is_approved, u.is_admin, u.created_at,
                       r.name AS role_name, r.color AS role_color
                FROM users u
                LEFT JOIN roles r ON r.id = u.role_id
                ORDER BY u.created_at DESC`),
    pool.query('SELECT * FROM roles ORDER BY priority DESC, name'),
    pool.query(`SELECT c.*, item.name AS item_name
                FROM contribution_campaigns c
                LEFT JOIN inventory_items item ON item.id = c.inventory_item_id
                ORDER BY c.starts_at DESC, c.created_at DESC`),
    pool.query(`SELECT s.*, u.display_name, item.name AS item_name,
                       c.name AS campaign_name,
                       COALESCE(s.resource_type, c.resource_type) AS resource_type,
                       c.target_amount,
                       c.starts_at, c.ends_at
                FROM submissions s
                JOIN users u ON u.id = s.user_id
                LEFT JOIN inventory_items item ON item.id = s.inventory_item_id
                LEFT JOIN contribution_campaigns c ON c.id = s.campaign_id
                ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.submitted_at DESC`),
    pool.query('SELECT * FROM inventory_items ORDER BY name'),
    pool.query('SELECT * FROM menu_items ORDER BY name'),
    pool.query('SELECT * FROM events ORDER BY starts_at NULLS LAST, title'),
    pool.query('SELECT * FROM finance WHERE id = 1'),
  ]);
  res.json({
    users: users.rows,
    roles: roles.rows,
    campaigns: campaigns.rows,
    submissions: submissions.rows,
    inventory: inventory.rows,
    menu: menu.rows,
    events: events.rows,
    finance: finance.rows[0],
  });
}));

app.post('/api/admin/assets', requireAdmin, upload.single('image'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Bitte wähle ein Bild aus.' });
  let optimized;
  try {
    optimized = await optimizeImage(req.file);
  } catch {
    return res.status(400).json({ error: 'Das Bild konnte nicht verarbeitet werden. Bitte verwende eine gültige Bilddatei.' });
  }
  const { rows } = await pool.query(`
    INSERT INTO assets (file_name, mime_type, data) VALUES ($1, $2, $3) RETURNING id
  `, [optimized.fileName, optimized.mimeType, optimized.buffer.toString('base64')]);
  res.status(201).json({
    id: rows[0].id,
    url: `/api/assets/${rows[0].id}`,
    originalBytes: req.file.size,
    storedBytes: optimized.buffer.length,
  });
}));

app.put('/api/admin/users/:id', requireAdmin, asyncRoute(async (req, res) => {
  const userId = intValue(req.params.id);
  const firstName = trimmed(req.body.firstName, 80);
  const lastName = trimmed(req.body.lastName, 80);
  const displayName = `${firstName} ${lastName}`.trim();
  const isMichaelBlack = displayName.toLocaleLowerCase('de-DE') === 'michael black';
  const isAdmin = isMichaelBlack || Boolean(req.body.isAdmin);
  const birthDate = trimmed(req.body.birthDate, 10);
  const parsedBirthDate = validBirthDate(birthDate);
  const gender = String(req.body.gender || '');
  if (userId === req.user.id && !isAdmin) {
    return res.status(400).json({ error: 'Du kannst dir deine eigenen Adminrechte nicht entziehen.' });
  }
  if (!icNamePattern.test(firstName) || !icNamePattern.test(lastName)) {
    return res.status(400).json({ error: 'Bitte gib einen gültigen IC-Vor- und Nachnamen ein.' });
  }
  if (displayName.length > 100) return res.status(400).json({ error: 'Der vollständige IC-Name ist zu lang.' });
  if (!parsedBirthDate) return res.status(400).json({ error: 'Bitte gib ein gültiges IC-Geburtsdatum ein.' });
  if (!['male', 'female'].includes(gender)) return res.status(400).json({ error: 'Bitte wähle männlich oder weiblich.' });
  const { rows } = await pool.query(`
    UPDATE users SET username = $1, display_name = $1, first_name = $2, last_name = $3,
      gender = $4, age = $5, birth_date = $6, task_area = $7, about = $8,
      role_id = $9, avatar_asset_id = $10, is_approved = TRUE, is_admin = $11
    WHERE id = $12
    RETURNING id, display_name, is_approved, is_admin
  `, [
    displayName, firstName, lastName, gender, ageFromBirthDate(parsedBirthDate), birthDate,
    trimmed(req.body.taskArea, 500), trimmed(req.body.about, 1200), optionalInt(req.body.roleId),
    optionalInt(req.body.avatarAssetId), isAdmin, userId,
  ]);
  if (!rows[0]) return res.status(404).json({ error: 'Account nicht gefunden.' });
  res.json({ user: rows[0] });
}));

app.delete('/api/admin/users/:id', requireAdmin, asyncRoute(async (req, res) => {
  const userId = intValue(req.params.id);
  if (userId === req.user.id) return res.status(400).json({ error: 'Du kannst deinen eigenen Account nicht löschen.' });
  const result = await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  if (!result.rowCount) return res.status(404).json({ error: 'Account nicht gefunden.' });
  res.json({ ok: true });
}));

function campaignInput(body) {
  const name = trimmed(body.name, 140);
  const resourceType = String(body.resourceType || '');
  const targetAmount = intValue(body.targetAmount);
  const inventoryItemId = resourceType === 'item' ? optionalInt(body.inventoryItemId) : null;
  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(body.endsAt);
  if (name.length < 2) return { error: 'Bitte gib einen Namen für den Abgabezeitraum ein.' };
  if (!['cash', 'dirty_cash', 'item'].includes(resourceType)) return { error: 'Bitte wähle Geld, Schwarzgeld oder einen Inventarartikel.' };
  if (targetAmount <= 0 || targetAmount > 1000000000000) return { error: 'Bitte gib ein gültiges Ziel ein.' };
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    return { error: 'Der Zeitraum ist ungültig. Das Ende muss nach dem Start liegen.' };
  }
  if (resourceType === 'item' && !inventoryItemId) return { error: 'Bitte wähle einen Inventarartikel.' };
  return { name, resourceType, targetAmount, inventoryItemId, startsAt, endsAt };
}

app.post('/api/admin/campaigns', requireAdmin, asyncRoute(async (req, res) => {
  const input = campaignInput(req.body);
  if (input.error) return res.status(400).json({ error: input.error });
  if (input.inventoryItemId) {
    const item = await pool.query('SELECT id FROM inventory_items WHERE id = $1', [input.inventoryItemId]);
    if (!item.rows[0]) return res.status(400).json({ error: 'Der gewählte Inventarartikel existiert nicht.' });
  }
  const { rows } = await pool.query(`
    INSERT INTO contribution_campaigns
      (name, resource_type, inventory_item_id, target_amount, starts_at, ends_at, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [input.name, input.resourceType, input.inventoryItemId, input.targetAmount,
    input.startsAt, input.endsAt, req.user.id]);
  res.status(201).json({ campaign: rows[0] });
}));

app.put('/api/admin/campaigns/:id', requireAdmin, asyncRoute(async (req, res) => {
  const input = campaignInput(req.body);
  if (input.error) return res.status(400).json({ error: input.error });
  if (input.inventoryItemId) {
    const item = await pool.query('SELECT id FROM inventory_items WHERE id = $1', [input.inventoryItemId]);
    if (!item.rows[0]) return res.status(400).json({ error: 'Der gewählte Inventarartikel existiert nicht.' });
  }
  const { rows } = await pool.query(`
    UPDATE contribution_campaigns
    SET name = $1, resource_type = $2, inventory_item_id = $3, target_amount = $4,
        starts_at = $5, ends_at = $6, updated_at = NOW()
    WHERE id = $7 RETURNING *
  `, [input.name, input.resourceType, input.inventoryItemId, input.targetAmount,
    input.startsAt, input.endsAt, intValue(req.params.id)]);
  if (!rows[0]) return res.status(404).json({ error: 'Abgabezeitraum nicht gefunden.' });
  res.json({ campaign: rows[0] });
}));

app.delete('/api/admin/campaigns/:id', requireAdmin, asyncRoute(async (req, res) => {
  const campaignId = intValue(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const campaign = await client.query(
      'SELECT * FROM contribution_campaigns WHERE id = $1 FOR UPDATE',
      [campaignId],
    );
    if (!campaign.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Abgabezeitraum nicht gefunden.' });
    }
    const submissions = await client.query(`
      SELECT s.*, COALESCE(s.resource_type, $2) AS effective_resource_type
      FROM submissions s
      WHERE s.campaign_id = $1
      FOR UPDATE
    `, [campaignId, campaign.rows[0].resource_type]);
    let reversedApproved = 0;
    let reversedAmount = 0;
    for (const submission of submissions.rows) {
      if (submission.status !== 'approved') continue;
      await adjustSubmissionBooking(client, {
        ...submission,
        resource_type: submission.effective_resource_type,
      }, -1);
      reversedApproved += 1;
      reversedAmount += Number(submission.amount);
    }
    await client.query('DELETE FROM submissions WHERE campaign_id = $1', [campaignId]);
    await client.query('DELETE FROM contribution_campaigns WHERE id = $1', [campaignId]);
    await client.query('COMMIT');
    res.json({ ok: true, deletedSubmissions: submissions.rowCount, reversedApproved, reversedAmount });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

function bookingConflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

async function adjustSubmissionBooking(client, submission, direction) {
  const amount = Number(submission.amount) * direction;
  if (!Number.isSafeInteger(amount) || !['cash', 'dirty_cash', 'item'].includes(submission.resource_type)) {
    throw bookingConflict('Die Buchung dieser Abgabe ist unvollständig und kann nicht geändert werden.');
  }
  if (submission.resource_type === 'item') {
    if (!submission.inventory_item_id) {
      throw bookingConflict('Der zugeordnete Inventarartikel existiert nicht mehr.');
    }
    const inventory = await client.query(`
      UPDATE inventory_items SET quantity = quantity + $1, updated_at = NOW()
      WHERE id = $2 AND quantity + $1 >= 0
      RETURNING id, name, quantity
    `, [amount, submission.inventory_item_id]);
    if (!inventory.rows[0]) {
      throw bookingConflict(direction < 0
        ? 'Die Bestätigung kann nicht rückgängig gemacht werden, weil der Artikelbestand dafür nicht ausreicht.'
        : 'Der zugeordnete Inventarartikel existiert nicht mehr.');
    }
    return { type: 'item', name: inventory.rows[0].name, total: inventory.rows[0].quantity };
  }
  const column = submission.resource_type === 'dirty_cash' ? 'dirty_cash' : 'cash';
  const finance = await client.query(`
    UPDATE finance SET ${column} = ${column} + $1, updated_at = NOW()
    WHERE id = 1 AND ${column} + $1 >= 0
    RETURNING ${column} AS total
  `, [amount]);
  if (!finance.rows[0]) {
    throw bookingConflict(direction < 0
      ? `Die Bestätigung kann nicht rückgängig gemacht werden, weil nicht genug ${submission.resource_type === 'dirty_cash' ? 'Schwarzgeld' : 'Geld'} vorhanden ist.`
      : 'Der Kontostand konnte nicht aktualisiert werden.');
  }
  return {
    type: submission.resource_type,
    name: submission.resource_type === 'dirty_cash' ? 'Schwarzgeld' : 'Geld',
    total: finance.rows[0].total,
  };
}

app.patch('/api/admin/submissions/:id', requireAdmin, asyncRoute(async (req, res) => {
  const status = String(req.body.status || '');
  if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Ungültiger Status.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(`
      SELECT * FROM submissions WHERE id = $1 FOR UPDATE
    `, [intValue(req.params.id)]);
    const submission = current.rows[0];
    if (!submission) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Abgabe nicht gefunden.' });
    }
    if (!submission.resource_type && submission.campaign_id) {
      const campaign = await client.query(
        'SELECT resource_type FROM contribution_campaigns WHERE id = $1',
        [submission.campaign_id],
      );
      submission.resource_type = campaign.rows[0]?.resource_type;
    }
    if (status === 'pending') {
      if (submission.status === 'pending') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Diese Abgabe ist bereits offen.' });
      }
      const booking = submission.status === 'approved'
        ? await adjustSubmissionBooking(client, submission, -1)
        : null;
      const { rows } = await client.query(`
        UPDATE submissions SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL
        WHERE id = $1 RETURNING *
      `, [submission.id]);
      await client.query('COMMIT');
      return res.json({ submission: rows[0], booking, undone: true });
    }
    if (submission.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Bitte mache die bisherige Entscheidung zuerst rückgängig.' });
    }
    const booking = status === 'approved'
      ? await adjustSubmissionBooking(client, submission, 1)
      : null;
    const { rows } = await client.query(`
      UPDATE submissions SET status = $1, reviewed_by = $2, reviewed_at = NOW()
      WHERE id = $3 RETURNING *
    `, [status, req.user.id, submission.id]);
    await client.query('COMMIT');
    res.json({ submission: rows[0], booking });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/admin/roles', requireAdmin, asyncRoute(async (req, res) => {
  const name = trimmed(req.body.name, 80);
  if (name.length < 2) return res.status(400).json({ error: 'Bitte gib einen Rollennamen ein.' });
  const { rows } = await pool.query(`
    INSERT INTO roles (name, color, priority) VALUES ($1, $2, $3) RETURNING *
  `, [name, trimmed(req.body.color, 16) || '#7c3aed', intValue(req.body.priority)]);
  res.status(201).json({ role: rows[0] });
}));

app.put('/api/admin/roles/:id', requireAdmin, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`
    UPDATE roles SET name = $1, color = $2, priority = $3 WHERE id = $4 RETURNING *
  `, [trimmed(req.body.name, 80), trimmed(req.body.color, 16), intValue(req.body.priority), intValue(req.params.id)]);
  if (!rows[0]) return res.status(404).json({ error: 'Rolle nicht gefunden.' });
  res.json({ role: rows[0] });
}));

app.delete('/api/admin/roles/:id', requireAdmin, asyncRoute(async (req, res) => {
  const result = await pool.query('DELETE FROM roles WHERE id = $1', [intValue(req.params.id)]);
  if (!result.rowCount) return res.status(404).json({ error: 'Rolle nicht gefunden.' });
  res.json({ ok: true });
}));

function resourceRoutes({ pathName, table, fields, returning = '*' }) {
  app.post(`/api/admin/${pathName}`, requireAdmin, asyncRoute(async (req, res) => {
    const values = fields.map((field) => field.read(req.body));
    const placeholders = fields.map((_, index) => `$${index + 1}`).join(', ');
    const { rows } = await pool.query(
      `INSERT INTO ${table} (${fields.map((field) => field.column).join(', ')}) VALUES (${placeholders}) RETURNING ${returning}`,
      values,
    );
    res.status(201).json({ item: rows[0] });
  }));
  app.put(`/api/admin/${pathName}/:id`, requireAdmin, asyncRoute(async (req, res) => {
    const values = fields.map((field) => field.read(req.body));
    values.push(intValue(req.params.id));
    const assignments = fields.map((field, index) => `${field.column} = $${index + 1}`).concat('updated_at = NOW()').join(', ');
    const { rows } = await pool.query(`UPDATE ${table} SET ${assignments} WHERE id = $${values.length} RETURNING ${returning}`, values);
    if (!rows[0]) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
    res.json({ item: rows[0] });
  }));
  app.delete(`/api/admin/${pathName}/:id`, requireAdmin, asyncRoute(async (req, res) => {
    const itemId = intValue(req.params.id);
    if (pathName === 'inventory') {
      const campaigns = await pool.query(`
        SELECT COUNT(*)::int AS count FROM contribution_campaigns WHERE inventory_item_id = $1
      `, [itemId]);
      const pending = await pool.query(`
        SELECT COUNT(*)::int AS count FROM submissions WHERE inventory_item_id = $1 AND status = 'pending'
      `, [itemId]);
      if (Number(campaigns.rows[0].count) > 0 || Number(pending.rows[0].count) > 0) {
        return res.status(409).json({ error: 'Dieser Artikel wird noch in einem Abgabezeitraum oder einer offenen Abgabe verwendet.' });
      }
    }
    const result = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [itemId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
    res.json({ ok: true });
  }));
}

resourceRoutes({
  pathName: 'inventory',
  table: 'inventory_items',
  fields: [
    { column: 'name', read: (body) => trimmed(body.name, 120) },
    { column: 'quantity', read: (body) => Math.max(0, intValue(body.quantity)) },
    { column: 'description', read: (body) => trimmed(body.description, 500) },
    { column: 'image_asset_id', read: (body) => optionalInt(body.imageAssetId) },
  ],
});

resourceRoutes({
  pathName: 'menu',
  table: 'menu_items',
  fields: [
    { column: 'name', read: (body) => trimmed(body.name, 120) },
    { column: 'price_cents', read: (body) => Math.max(0, intValue(body.priceCents)) },
    { column: 'description', read: (body) => trimmed(body.description, 500) },
    { column: 'available', read: (body) => Boolean(body.available) },
    { column: 'image_asset_id', read: (body) => optionalInt(body.imageAssetId) },
  ],
});

resourceRoutes({
  pathName: 'events',
  table: 'events',
  fields: [
    { column: 'title', read: (body) => trimmed(body.title, 140) },
    { column: 'description', read: (body) => trimmed(body.description, 2000) },
    { column: 'location', read: (body) => trimmed(body.location, 160) },
    { column: 'starts_at', read: (body) => body.startsAt || null },
    { column: 'image_asset_id', read: (body) => optionalInt(body.imageAssetId) },
  ],
});

app.put('/api/admin/finance', requireAdmin, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`
    UPDATE finance SET cash = $1, dirty_cash = $2, updated_at = NOW() WHERE id = 1 RETURNING *
  `, [Math.max(0, intValue(req.body.cash)), Math.max(0, intValue(req.body.dirtyCash))]);
  res.json({ finance: rows[0] });
}));

app.use(express.static(publicDir, { maxAge: isProduction ? '1h' : 0 }));
app.get('*splat', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.use((error, _req, res, _next) => {
  if (error.status && Number.isInteger(error.status)) return res.status(error.status).json({ error: error.message });
  console.error(error);
  if (error.code === '23505') return res.status(409).json({ error: 'Dieser Name ist bereits vergeben.' });
  if (error instanceof multer.MulterError) return res.status(400).json({ error: 'Das Bild ist zu groß. Maximal 4 MB.' });
  if (error.message?.startsWith('Nur JPG')) return res.status(400).json({ error: error.message });
  res.status(500).json({ error: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.' });
});

const server = app.listen(port, () => {
  console.log(`Tequi-La-La Portal läuft auf http://localhost:${port}`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
