CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  color VARCHAR(16) NOT NULL DEFAULT '#7c3aed',
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(80) NOT NULL,
  data TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(40) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  age INTEGER,
  birth_date DATE,
  task_area TEXT NOT NULL DEFAULT '',
  about TEXT NOT NULL DEFAULT '',
  role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
  avatar_asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  submission_target INTEGER NOT NULL DEFAULT 0 CHECK (submission_target >= 0),
  is_approved BOOLEAN NOT NULL DEFAULT FALSE,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_approval ON users (is_approved, created_at);

CREATE TABLE IF NOT EXISTS submissions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  note VARCHAR(500) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_submissions_user_status ON submissions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_submissions_pending ON submissions (status, submitted_at);

CREATE TABLE IF NOT EXISTS inventory_items (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  description VARCHAR(500) NOT NULL DEFAULT '',
  image_asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_items (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  description VARCHAR(500) NOT NULL DEFAULT '',
  available BOOLEAN NOT NULL DEFAULT TRUE,
  image_asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  title VARCHAR(140) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location VARCHAR(160) NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ,
  image_asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finance (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cash INTEGER NOT NULL DEFAULT 0 CHECK (cash >= 0),
  dirty_cash INTEGER NOT NULL DEFAULT 0 CHECK (dirty_cash >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO finance (id, cash, dirty_cash) VALUES (1, 0, 0) ON CONFLICT (id) DO NOTHING;

INSERT INTO roles (name, color, priority) VALUES
  ('Inhaber', '#ff5b35', 110),
  ('Geschäftsführung', '#24e0ae', 100),
  ('Management', '#24cfa8', 90),
  ('Personalleitung', '#c25a00', 80),
  ('Eventmanager', '#ff2f73', 70),
  ('Sicherheitsleitung', '#2254ff', 60),
  ('Sicherheitsdienst', '#5d8aa8', 50),
  ('Barleitung', '#db6600', 40),
  ('Barkeeper', '#c95b00', 30),
  ('Praktikant', '#6d0acb', 20),
  ('Aushilfe', '#8418e8', 10)
ON CONFLICT (name) DO NOTHING;
