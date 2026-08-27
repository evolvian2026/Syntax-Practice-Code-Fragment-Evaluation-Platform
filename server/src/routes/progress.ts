import { Router } from 'express';
import { authenticate } from '../auth/index.js';
import { db } from '../db/index.js';
import { breakdown, dashboardFor, leaderboard } from '../db/repositories/progress.js';
import { listSubmissions } from '../db/repositories/submissions.js';
import { badgesFor, xpForLevel } from '../services/gamification.js';
import { learningPathFor } from '../services/learningPath.js';
import { gapsForUser, masteryForUser } from '../services/mastery.js';
import { dueForUser, summaryForUser } from '../services/review.js';
import { asyncHandler, parseIntParam } from './helpers.js';

export const progressRouter = Router();

progressRouter.use(authenticate);

/** §17 — the student dashboard payload. */
progressRouter.get('/dashboard', asyncHandler(async (req, res) => {
  const summary = dashboardFor(req.user!.id);
  const recent = listSubmissions({ userId: req.user!.id, mode: 'submit', limit: 10 });
  const badges = badgesFor(req.user!.id);

  res.json({
    summary,
    recentSubmissions: recent.items,
    badges: badges.filter((b) => b.earned).slice(0, 8),
    nextLevelXp: xpForLevel(summary.level + 1),
    currentLevelXp: xpForLevel(summary.level),
  });
}));

progressRouter.get('/breakdown/:dimension', asyncHandler(async (req, res) => {
  const dimension = req.params.dimension as 'language' | 'topic' | 'difficulty';
  if (!['language', 'topic', 'difficulty'].includes(dimension)) {
    res.status(400).json({ error: 'Unknown breakdown dimension.' });
    return;
  }
  res.json({ breakdown: breakdown(req.user!.id, dimension) });
}));

progressRouter.get('/badges', asyncHandler(async (req, res) => {
  res.json({ badges: badgesFor(req.user!.id) });
}));

progressRouter.get('/leaderboard', asyncHandler(async (req, res) => {
  const batch = typeof req.query.batch === 'string' ? req.query.batch : undefined;
  const rows = leaderboard(parseIntParam(req.query.limit, 20), batch);
  const me = rows.findIndex((r) => r.userId === req.user!.id);
  res.json({
    leaderboard: rows.map((r, i) => ({ ...r, rank: i + 1, isMe: r.userId === req.user!.id })),
    myRank: me === -1 ? null : me + 1,
  });
}));

/** §18 — learning path with unlock state. */
progressRouter.get('/learning-path', asyncHandler(async (req, res) => {
  const language = typeof req.query.language === 'string' ? req.query.language : 'python';
  res.json({ path: learningPathFor(language, req.user!.id) });
}));

progressRouter.get('/learning-paths', asyncHandler(async (_req, res) => {
  const paths = db().prepare(`
    SELECT p.slug, p.name, p.description, l.slug AS language, l.name AS language_name
    FROM learning_paths p JOIN languages l ON l.id = p.language_id
    WHERE p.is_enabled = 1 ORDER BY l.display_order
  `).all() as any[];
  res.json({ paths });
}));

/** Time-series for the activity heatmap. */
progressRouter.get('/activity', asyncHandler(async (req, res) => {
  const days = Math.min(parseIntParam(req.query.days, 90), 365);
  const rows = db().prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS attempts,
           COALESCE(SUM(is_correct), 0) AS solved
    FROM submissions
    WHERE user_id = ? AND mode = 'submit' AND created_at >= date('now', ?)
    GROUP BY date(created_at) ORDER BY day
  `).all(req.user!.id, `-${days} days`) as any[];
  res.json({ activity: rows });
}));

/** Construct-level mastery: what the student can actually write, not just which topics they visited. */
progressRouter.get('/mastery', asyncHandler(async (req, res) => {
  const language = typeof req.query.language === 'string' ? req.query.language : undefined;
  res.json({
    mastery: masteryForUser(req.user!.id, { language }),
    gaps: gapsForUser(req.user!.id, parseIntParam(req.query.gapLimit, 12)),
  });
}));

/** The spaced-repetition queue. */
progressRouter.get('/reviews', asyncHandler(async (req, res) => {
  res.json({
    summary: summaryForUser(req.user!.id),
    due: dueForUser(req.user!.id, parseIntParam(req.query.limit, 20)),
  });
}));
