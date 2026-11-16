-- Networky phase 7: drill practice, practice XP, profile visibility.

-- Record: one drill set the server handed out. The server draws the seed; the
-- client sends only answers, and the finish replays the set from the seed.
CREATE TABLE drill_sets (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  start_level  INTEGER NOT NULL CHECK (start_level BETWEEN 1 AND 3),
  seed         INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  finished_at  INTEGER,
  correct      INTEGER,             -- right answers out of 10
  earned       INTEGER,             -- XP before the daily cap
  xp           INTEGER,             -- XP after the cap: what counted
  answers      TEXT                 -- the 10 answers as JSON, so a retry replays the same result
);
CREATE INDEX drill_sets_user_time ON drill_sets(user_id, created_at);
CREATE INDEX drill_sets_user_finished ON drill_sets(user_id, finished_at) WHERE finished_at IS NOT NULL;

-- Problem XP and practice XP share the ledger; the weekly board sums both,
-- the all-time board and levels read user_stats (problems only).
ALTER TABLE xp_events ADD COLUMN source TEXT NOT NULL DEFAULT 'problem' CHECK (source IN ('problem', 'drill'));
-- "XP over time" on a profile reads one user's events; the old index starts with the time.
CREATE INDEX xp_events_user_time ON xp_events(user_id, created_at);

-- 'hidden': the profile answers 404 to everyone but its owner, and the
-- leaderboard shows the row without a name or link.
ALTER TABLE users ADD COLUMN profile_visibility TEXT NOT NULL DEFAULT 'public' CHECK (profile_visibility IN ('public', 'hidden'));
