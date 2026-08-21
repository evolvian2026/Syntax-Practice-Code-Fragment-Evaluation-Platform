import { Router } from 'express';
import { z } from 'zod';
import {
  authenticate, createUser, DuplicateEmailError, findUserByEmail, findUserById,
  signToken, verifyPassword,
} from '../auth/index.js';
import { db } from '../db/index.js';
import { asyncHandler, validate } from './helpers.js';

export const authRouter = Router();

const credentials = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
});

const registration = credentials.extend({
  fullName: z.string().min(2, 'Tell us your name.'),
  batch: z.string().optional().nullable(),
});

authRouter.post('/register', asyncHandler(async (req, res) => {
  const input = validate(registration, req.body);
  try {
    const user = await createUser({
      email: input.email,
      password: input.password,
      fullName: input.fullName,
      batch: input.batch ?? null,
      role: 'student',
    });
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
}));

authRouter.post('/login', asyncHandler(async (req, res) => {
  const input = validate(credentials, req.body);
  const found = findUserByEmail(input.email);
  if (!found || !(await verifyPassword(input.password, found.passwordHash))) {
    res.status(401).json({ error: 'Email or password is incorrect.' });
    return;
  }
  const { passwordHash, ...user } = found;
  res.json({ token: signToken(user), user });
}));

authRouter.get('/me', authenticate, asyncHandler(async (req, res) => {
  const profile = db().prepare(
    'SELECT xp, level, streak_current, streak_best, batch, preferred_theme FROM students WHERE user_id = ?',
  ).get(req.user!.id) as any;
  res.json({
    user: req.user,
    profile: profile
      ? {
        xp: profile.xp,
        level: profile.level,
        streakCurrent: profile.streak_current,
        streakBest: profile.streak_best,
        batch: profile.batch,
        theme: profile.preferred_theme,
      }
      : null,
  });
}));

authRouter.patch('/me', authenticate, asyncHandler(async (req, res) => {
  const input = validate(
    z.object({
      fullName: z.string().min(2).optional(),
      theme: z.enum(['dark', 'light']).optional(),
      batch: z.string().nullable().optional(),
    }),
    req.body,
  );
  const conn = db();
  if (input.fullName) {
    conn.prepare(`UPDATE users SET full_name = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(input.fullName, req.user!.id);
  }
  if (input.theme) {
    conn.prepare('UPDATE students SET preferred_theme = ? WHERE user_id = ?').run(input.theme, req.user!.id);
  }
  if (input.batch !== undefined) {
    conn.prepare('UPDATE students SET batch = ? WHERE user_id = ?').run(input.batch, req.user!.id);
  }
  res.json({ user: findUserById(req.user!.id) });
}));

authRouter.post('/change-password', authenticate, asyncHandler(async (req, res) => {
  const input = validate(
    z.object({ currentPassword: z.string(), newPassword: z.string().min(6) }),
    req.body,
  );
  const found = findUserByEmail(req.user!.email);
  if (!found || !(await verifyPassword(input.currentPassword, found.passwordHash))) {
    res.status(400).json({ error: 'Your current password is incorrect.' });
    return;
  }
  const { hashPassword } = await import('../auth/index.js');
  const hash = await hashPassword(input.newPassword);
  db().prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(hash, req.user!.id);
  res.json({ ok: true });
}));
