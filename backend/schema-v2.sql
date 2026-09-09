-- ============================================================
-- SoundsOfV12 backend — migration 2
--
-- Three things the first schema could not do:
--
--   1. Polls that V12 can change himself. They used to be hardcoded in
--      raris.html, so "add a poll" meant "edit HTML and redeploy", and a
--      poll could never close. Now the question, the options and the
--      deadline live in the database and the admin page edits them.
--
--   2. Enforce a deadline. The vote route reads closes_at and refuses a
--      late vote, because a countdown the server does not enforce is
--      decoration — anyone with a console can post after it expires.
--
--   3. Prove an email was actually handed to the provider. Accepting a
--      signup and silently never mailing anyone is the failure mode this
--      table exists to make visible.
--
-- Safe to re-run. Apply with:
--   npx wrangler d1 execute soundsofv12 --remote --file=backend/schema-v2.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS polls (
  id         TEXT PRIMARY KEY,           -- short slug, also the poll_votes key
  question   TEXT NOT NULL,
  subtitle   TEXT,
  -- UTC, 'YYYY-MM-DD HH:MM:SS' so it compares directly against
  -- datetime('now'). NULL means the poll runs until it is closed by hand.
  closes_at  TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (length(id) BETWEEN 1 AND 40),
  CHECK (length(question) BETWEEN 1 AND 160)
);

CREATE TABLE IF NOT EXISTS poll_options (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  poll  TEXT NOT NULL,
  key   TEXT NOT NULL,                   -- what poll_votes.choice stores
  label TEXT NOT NULL,
  sort  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (poll, key),
  CHECK (length(key) BETWEEN 1 AND 40),
  CHECK (length(label) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS poll_options_poll_idx ON poll_options(poll, sort);


-- One row per message handed to the mail provider.
--
-- `status` is 'accepted', not 'delivered': a 200 from Resend means it
-- took the message, not that a mailbox got it. That distinction has bitten
-- before, so the column is named for what it actually knows.
CREATE TABLE IF NOT EXISTS mail_sends (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr     TEXT NOT NULL,
  kind        TEXT NOT NULL,             -- 'welcome'
  provider_id TEXT,                      -- Resend message id, for lookups
  status      TEXT NOT NULL,             -- 'accepted' | 'error'
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Somebody who signs up twice gets one welcome, not two.
CREATE UNIQUE INDEX IF NOT EXISTS mail_sends_once
  ON mail_sends(lower(to_addr), kind) WHERE status = 'accepted';

CREATE INDEX IF NOT EXISTS mail_sends_time_idx ON mail_sends(created_at);


-- Seed the two polls that were hardcoded in raris.html, keeping the same
-- ids and option keys so every vote already cast still counts.
INSERT OR IGNORE INTO polls (id, question, subtitle, sort) VALUES
  ('game', 'Next stream game?',  'Rari''s decide the vibe.',    0),
  ('drop', 'What drops next?',   'Push the release you want.',  1);

INSERT OR IGNORE INTO poll_options (poll, key, label, sort) VALUES
  ('game', '2k',        'NBA 2K',              0),
  ('game', 'fc',        'EA FC (soccer)',      1),
  ('game', 'fort',      'Fortnite',            2),
  ('game', 'gta',       'GTA',                 3),
  ('drop', 'rumba-vid', 'RUMBA music video',   0),
  ('drop', 'single',    'Brand-new single',    1),
  ('drop', 'remix',     'RUMBA remix ft. ___', 2);


-- ============================================================
-- Booking inquiries
--
-- The form on book.html carried `data-join`, so the newsletter handler
-- claimed it, read the "Your name" box as if it were an email address,
-- failed validation and stopped. Every show, brand and sync inquiry ever
-- typed into that form died in the browser without anyone being told.
--
-- Stored here BEFORE the notification email is attempted, so an inquiry
-- survives the mail provider having a bad day.
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  contact    TEXT NOT NULL,          -- email or phone, as typed
  kind       TEXT,                   -- 'Live performance / show', …
  when_where TEXT,
  details    TEXT,
  handled    INTEGER NOT NULL DEFAULT 0,
  visitor_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (length(name) BETWEEN 1 AND 80),
  CHECK (length(contact) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS bookings_time_idx    ON bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_visitor_idx ON bookings(visitor_id, created_at);
