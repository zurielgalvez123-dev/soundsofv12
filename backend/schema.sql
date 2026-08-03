-- ============================================================
-- SoundsOfV12 backend — schema
--
-- Three things the site needs to persist and share between fans:
-- signups, the fan wall, and poll votes. Plus opt-outs, because the
-- outreach email carries an unsubscribe link that has to do something.
--
-- Access control is NOT in this file. Unlike a Supabase-style setup
-- where the browser talks to the database directly and row policies do
-- the protecting, here the browser only ever talks to our own Worker.
-- The Worker decides what is readable. The signup list has no read
-- route at all, which is a stronger guarantee than a policy you can
-- misconfigure.
-- ============================================================

CREATE TABLE IF NOT EXISTS signups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT,
  phone       TEXT,
  source_page TEXT,
  visitor_id  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- A repeat signup should be a no-op, not an error or a duplicate row.
CREATE UNIQUE INDEX IF NOT EXISTS signups_email_key ON signups(lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS signups_phone_key ON signups(phone)        WHERE phone IS NOT NULL;


CREATE TABLE IF NOT EXISTS wall_posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  city       TEXT,
  text       TEXT NOT NULL,
  visitor_id TEXT,
  hidden     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (length(name) BETWEEN 1 AND 40),
  CHECK (length(text) BETWEEN 1 AND 180),
  CHECK (city IS NULL OR length(city) <= 30)
);

CREATE INDEX IF NOT EXISTS wall_visible_idx ON wall_posts(created_at DESC) WHERE hidden = 0;


CREATE TABLE IF NOT EXISTS poll_votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  poll       TEXT NOT NULL,
  choice     TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (poll, visitor_id)     -- changing your mind moves the vote
);

CREATE INDEX IF NOT EXISTS poll_votes_poll_idx ON poll_votes(poll);


CREATE TABLE IF NOT EXISTS optouts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  source     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS optouts_email_key ON optouts(lower(email));


-- Crude but effective abuse brake for the wall: one row per post, so
-- the Worker can count recent posts per visitor without a KV namespace.
CREATE INDEX IF NOT EXISTS wall_visitor_recent_idx ON wall_posts(visitor_id, created_at);
