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
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function currentUser(userId) {
  if (!userId) return null;
  const { rows } = await pool.query(`
    SELECT u.id, u.username, u.email, u.display_name, u.age, u.birth_date, u.task_area,
           u.about, u.role_id, u.avatar_asset_id, u.submission_target, u.is_admin,
           u.is_approved, r.name AS role_name, r.color AS role_color
    FROM users u LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = $1
  `, [userId]);
  return rows[0] || null;
}

const requireAuth = asyncRoute(async (req, res, next) => {
  const user = await currentUser(req.session.userId);
  if (!user || !user.is_approved) {
    req.session.userId = null;
    return res.status(401).json({ error: 'Bitte melde dich an.' });
  }
  req.user = user;
  next();
});

const requireAdmin = asyncRoute(async (req, res, next) => {
  const user = await currentUser(req.session.userId);
  if (!user || !user.is_approved || !user.is_admin) return res.status(403).json({ error: 'Nur für Admins.' });
  req.user = user;
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/register', authLimiter, asyncRoute(async (req, res) => {
  const username = trimmed(req.body.username, 40);
  const email = trimmed(req.body.email, 255).toLowerCase();
  const displayName = trimmed(req.body.displayName, 100);
  const password = String(req.body.password || '');

  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
    return res.status(400).json({ error: 'Der Benutzername braucht 3–40 erlaubte Zeichen.' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Bitte gib eine gültige E-Mail-Adresse ein.' });
  if (displayName.length < 2) return res.status(400).json({ error: 'Bitte gib deinen Namen ein.' });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Das Passwort muss mindestens 8 Zeichen haben.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!usingMemory) await client.query('SELECT pg_advisory_xact_lock(734221)');
    const countResult = await client.query('SELECT COUNT(*)::int AS count FROM users');
    const isFirst = Number(countResult.rows[0].count) === 0;
    const ownerRole = isFirst ? await client.query("SELECT id FROM roles WHERE name = 'Inhaber' LIMIT 1") : { rows: [] };
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await client.query(`
      INSERT INTO users (username, email, password_hash, display_name, role_id, is_approved, is_admin)
      VALUES ($1, $2, $3, $4, $5, $6, $6)
      RETURNING id, username, display_name, is_approved, is_admin
    `, [username, email, passwordHash, displayName, ownerRole.rows[0]?.id || null, isFirst]);
    await client.query('COMMIT');

    if (isFirst) {
      req.session.userId = result.rows[0].id;
      return req.session.save(() => res.status(201).json({ user: result.rows[0], firstAdmin: true }));
    }
    res.status(201).json({ pending: true, message: 'Dein Account wartet auf die Freigabe durch einen Admin.' });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'Benutzername oder E-Mail-Adresse ist bereits vergeben.' });
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/auth/login', authLimiter, asyncRoute(async (req, res) => {
  const login = trimmed(req.body.login, 255).toLowerCase();
  const password = String(req.body.password || '');
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $1 LIMIT 1', [login]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Anmeldedaten stimmen nicht.' });
  }
  if (!user.is_approved) return res.status(403).json({ error: 'Dein Account wurde noch nicht freigeschaltet.', pending: true });
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
  if (!user?.is_approved) return res.status(401).json({ user: null });
  res.json({ user });
}));

app.get('/api/assets/:id', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT file_name, mime_type, data FROM assets WHERE id = $1', [intValue(req.params.id)]);
  if (!rows[0]) return res.status(404).end();
  res.set('Content-Type', rows[0].mime_type);
  res.set('Cache-Control', 'private, max-age=86400');
  res.send(Buffer.from(rows[0].data, 'base64'));
}));

app.get('/api/dashboard', requireAuth, asyncRoute(async (req, res) => {
  const [staff, pending, inventory, events, finance] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS count FROM users WHERE is_approved = TRUE'),
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

app.get('/api/staff', requireAuth, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.display_name, u.age, u.birth_date, u.task_area, u.about, u.avatar_asset_id,
           r.name AS role_name, r.color AS role_color
    FROM users u LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.is_approved = TRUE
    ORDER BY COALESCE(r.priority, -1) DESC, u.display_name ASC
  `);
  res.json({ staff: rows });
}));

app.get('/api/progress', requireAuth, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.display_name, u.submission_target, u.avatar_asset_id,
           r.name AS role_name, r.color AS role_color,
           COALESCE(SUM(CASE WHEN s.status = 'approved' THEN s.amount ELSE 0 END), 0)::int AS approved_amount,
           COALESCE(SUM(CASE WHEN s.status = 'pending' THEN s.amount ELSE 0 END), 0)::int AS pending_amount
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN submissions s ON s.user_id = u.id
    WHERE u.is_approved = TRUE
    GROUP BY u.id, u.display_name, u.submission_target, u.avatar_asset_id,
             r.name, r.color, r.priority
    ORDER BY COALESCE(r.priority, -1) DESC, u.display_name
  `);
  res.json({ progress: rows });
}));

app.get('/api/submissions', requireAuth, asyncRoute(async (req, res) => {
  const admin = Boolean(req.user.is_admin);
  const values = admin ? [] : [req.user.id];
  const where = admin ? '' : 'WHERE s.user_id = $1';
  const { rows } = await pool.query(`
    SELECT s.id, s.amount, s.note, s.status, s.submitted_at, s.reviewed_at,
           u.id AS user_id, u.display_name, reviewer.display_name AS reviewer_name
    FROM submissions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN users reviewer ON reviewer.id = s.reviewed_by
    ${where}
    ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.submitted_at DESC
  `, values);
  res.json({ submissions: rows });
}));

app.post('/api/submissions', requireAuth, asyncRoute(async (req, res) => {
  const amount = intValue(req.body.amount);
  const note = trimmed(req.body.note, 500);
  if (amount <= 0 || amount > 1000000000) return res.status(400).json({ error: 'Bitte gib eine gültige Menge ein.' });
  const { rows } = await pool.query(`
    INSERT INTO submissions (user_id, amount, note) VALUES ($1, $2, $3)
    RETURNING id, amount, note, status, submitted_at
  `, [req.user.id, amount, note]);
  res.status(201).json({ submission: rows[0] });
}));

app.get('/api/inventory', requireAuth, asyncRoute(async (_req, res) => {
  const [items, finance] = await Promise.all([
    pool.query('SELECT * FROM inventory_items ORDER BY name'),
    pool.query('SELECT cash, dirty_cash, updated_at FROM finance WHERE id = 1'),
  ]);
  res.json({ items: items.rows, finance: finance.rows[0] });
}));

app.get('/api/menu', requireAuth, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM menu_items ORDER BY available DESC, name');
  res.json({ items: rows });
}));

app.get('/api/events', requireAuth, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM events ORDER BY starts_at NULLS LAST, title');
  res.json({ events: rows });
}));

app.get('/api/admin/overview', requireAdmin, asyncRoute(async (_req, res) => {
  const [users, roles, submissions, inventory, menu, events, finance] = await Promise.all([
    pool.query(`SELECT u.id, u.username, u.email, u.display_name, u.age, u.birth_date, u.task_area, u.about,
                       u.role_id, u.avatar_asset_id, u.submission_target, u.is_approved, u.is_admin, u.created_at,
                       r.name AS role_name, r.color AS role_color
                FROM users u LEFT JOIN roles r ON r.id = u.role_id ORDER BY u.created_at DESC`),
    pool.query('SELECT * FROM roles ORDER BY priority DESC, name'),
    pool.query(`SELECT s.*, u.display_name FROM submissions s JOIN users u ON u.id = s.user_id
                ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.submitted_at DESC`),
    pool.query('SELECT * FROM inventory_items ORDER BY name'),
    pool.query('SELECT * FROM menu_items ORDER BY name'),
    pool.query('SELECT * FROM events ORDER BY starts_at NULLS LAST, title'),
    pool.query('SELECT * FROM finance WHERE id = 1'),
  ]);
  res.json({
    users: users.rows,
    roles: roles.rows,
    submissions: submissions.rows,
    inventory: inventory.rows,
    menu: menu.rows,
    events: events.rows,
    finance: finance.rows[0],
  });
}));

app.post('/api/admin/assets', requireAdmin, upload.single('image'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Bitte wähle ein Bild aus.' });
  const { rows } = await pool.query(`
    INSERT INTO assets (file_name, mime_type, data) VALUES ($1, $2, $3) RETURNING id
  `, [trimmed(req.file.originalname, 255), req.file.mimetype, req.file.buffer.toString('base64')]);
  res.status(201).json({ id: rows[0].id, url: `/api/assets/${rows[0].id}` });
}));

app.put('/api/admin/users/:id', requireAdmin, asyncRoute(async (req, res) => {
  const userId = intValue(req.params.id);
  const isAdmin = Boolean(req.body.isAdmin);
  const isApproved = Boolean(req.body.isApproved);
  if (userId === req.user.id && (!isAdmin || !isApproved)) {
    return res.status(400).json({ error: 'Du kannst dir deine eigenen Adminrechte nicht entziehen.' });
  }
  const { rows } = await pool.query(`
    UPDATE users SET display_name = $1, age = $2, birth_date = $3, task_area = $4, about = $5,
      role_id = $6, avatar_asset_id = $7, submission_target = $8, is_approved = $9, is_admin = $10
    WHERE id = $11
    RETURNING id, display_name, is_approved, is_admin
  `, [
    trimmed(req.body.displayName, 100), optionalInt(req.body.age), req.body.birthDate || null,
    trimmed(req.body.taskArea, 500), trimmed(req.body.about, 1200), optionalInt(req.body.roleId),
    optionalInt(req.body.avatarAssetId), Math.max(0, intValue(req.body.submissionTarget)),
    isApproved, isAdmin, userId,
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

app.patch('/api/admin/submissions/:id', requireAdmin, asyncRoute(async (req, res) => {
  const status = String(req.body.status || '');
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Ungültiger Status.' });
  const { rows } = await pool.query(`
    UPDATE submissions SET status = $1, reviewed_by = $2, reviewed_at = NOW()
    WHERE id = $3 AND status = 'pending' RETURNING *
  `, [status, req.user.id, intValue(req.params.id)]);
  if (!rows[0]) return res.status(404).json({ error: 'Offene Abgabe nicht gefunden.' });
  res.json({ submission: rows[0] });
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
    const result = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [intValue(req.params.id)]);
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
