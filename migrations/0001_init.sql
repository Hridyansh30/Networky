-- Networky phase 6: accounts, the judge, and what the leaderboard reads.
--
-- Two kinds of table:
--   records  what happened, written once (submissions, hint_unlocks,
--            predict_answers, xp_events). The source of truth.
--   caches   derived from records and rebuilt inside the same atomic batch
--            that writes a record (user_problem, user_stats, problem_stats).
--            Never incremented, so a retried or racing write cannot make
--            them drift. See server/judge.ts.
--
-- Times are integer milliseconds since 1970 (UTC). Booleans are 0/1.
-- D1 is SQLite: foreign keys are enforced per connection by D1.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  handle        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  created_at    INTEGER NOT NULL,
  banned_at     INTEGER,
  imported_at   INTEGER            -- the one-time import of phase 5 progress
);

-- How a user signs in. The provider's numeric id, never the login name:
-- GitHub users can rename themselves.
CREATE TABLE identities (
  provider          TEXT NOT NULL,
  provider_user_id  TEXT NOT NULL,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at        INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);

-- Only the SHA-256 of a session token is stored. A copy of this table
-- does not let anyone log in.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- One attempt = one variant of a problem. The server draws the seed; a
-- submission names its attempt and never carries a seed of its own.
CREATE TABLE attempts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  spec_version  INTEGER NOT NULL,
  seed          INTEGER,            -- NULL for problems without variants
  network       TEXT,               -- the autosaved draft (not graded)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX attempts_user_slug ON attempts(user_id, slug, created_at);

-- Every graded Submit, and every completed set of predict answers.
-- The id is made by the client, so a retried request is recognised.
CREATE TABLE submissions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempt_id      TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,
  spec_version    INTEGER NOT NULL,
  engine_version  TEXT NOT NULL,
  seed            INTEGER,
  kind            TEXT NOT NULL,     -- 'network' | 'predict'
  source          TEXT NOT NULL,     -- 'submit' | 'import'
  network_hash    TEXT,              -- SHA-256 of the network with ids and MACs stripped
  network         TEXT,              -- kept only while it is worth keeping (see judge.ts)
  raw_score       INTEGER NOT NULL,
  hinted_score    INTEGER NOT NULL,
  max_score       INTEGER NOT NULL,
  passed          INTEGER NOT NULL,
  report          TEXT NOT NULL,     -- the redacted report returned to the client
  created_at      INTEGER NOT NULL
);
CREATE INDEX submissions_user_slug ON submissions(user_id, slug, created_at);
CREATE INDEX submissions_user_time ON submissions(user_id, created_at);
CREATE INDEX submissions_hash ON submissions(slug, network_hash) WHERE passed = 1;

-- Written BEFORE a hint's text is returned. Not reset by Start over.
CREATE TABLE hint_unlocks (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL,
  requirement  TEXT NOT NULL,
  level        INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, slug, requirement)
);

-- The primary key is what makes a predict answer final.
CREATE TABLE predict_answers (
  attempt_id   TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id  TEXT NOT NULL,
  choice       TEXT NOT NULL,
  correct      INTEGER NOT NULL,
  answered_at  INTEGER NOT NULL,
  PRIMARY KEY (attempt_id, question_id)
);

-- Cache: one row per user and problem, rebuilt from submissions.
-- first_try and the solution flags are set once and never rebuilt.
CREATE TABLE user_problem (
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug             TEXT NOT NULL,
  difficulty       TEXT NOT NULL,      -- copied from the problem, for per-difficulty counts
  solved           INTEGER NOT NULL DEFAULT 0,
  solved_at        INTEGER,
  best             REAL NOT NULL DEFAULT 0,
  first_try        REAL,
  solution_opened  INTEGER NOT NULL DEFAULT 0,
  solution_first   INTEGER NOT NULL DEFAULT 0,
  submits          INTEGER NOT NULL DEFAULT 0,
  failed_submits   INTEGER NOT NULL DEFAULT 0,
  xp               INTEGER NOT NULL DEFAULT 0,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (user_id, slug)
);

-- Record: every time a user's XP went up, and why. Weekly boards read this.
CREATE TABLE xp_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  delta       INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX xp_events_time ON xp_events(created_at, user_id);

-- Cache: what a profile and the leaderboard show.
CREATE TABLE user_stats (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  xp             INTEGER NOT NULL DEFAULT 0,
  solved         INTEGER NOT NULL DEFAULT 0,
  solved_easy    INTEGER NOT NULL DEFAULT 0,
  solved_medium  INTEGER NOT NULL DEFAULT 0,
  solved_hard    INTEGER NOT NULL DEFAULT 0,
  xp_reached_at  INTEGER NOT NULL
);
CREATE INDEX user_stats_rank ON user_stats(xp DESC, xp_reached_at ASC);

-- Cache: acceptance on the Problems page.
CREATE TABLE problem_stats (
  slug         TEXT PRIMARY KEY,
  submissions  INTEGER NOT NULL DEFAULT 0,
  accepted     INTEGER NOT NULL DEFAULT 0,
  tried        INTEGER NOT NULL DEFAULT 0,  -- users with at least one submission
  solvers      INTEGER NOT NULL DEFAULT 0   -- users who solved it
);
