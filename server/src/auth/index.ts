import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { db } from '../db/index.js';

export type Role = 'student' | 'teacher' | 'admin';

export interface AuthUser {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  avatarColor: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { sub: String(user.id), email: user.email, role: user.role, name: user.fullName },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] },
  );
}

export function verifyToken(token: string): { sub: string; role: Role } | null {
  try {
    return jwt.verify(token, config.jwtSecret) as { sub: string; role: Role };
  } catch {
    return null;
  }
}

export function findUserById(id: number): AuthUser | null {
  const row = db().prepare(
    'SELECT id, email, full_name, role, avatar_color, is_active FROM users WHERE id = ?',
  ).get(id) as any;
  if (!row || row.is_active !== 1) return null;
  return { id: row.id, email: row.email, fullName: row.full_name, role: row.role, avatarColor: row.avatar_color };
}

export function findUserByEmail(email: string): (AuthUser & { passwordHash: string }) | null {
  const row = db().prepare(
    'SELECT id, email, password_hash, full_name, role, avatar_color, is_active FROM users WHERE lower(email) = lower(?)',
  ).get(email) as any;
  if (!row || row.is_active !== 1) return null;
  return {
    id: row.id, email: row.email, fullName: row.full_name, role: row.role,
    avatarColor: row.avatar_color, passwordHash: row.password_hash,
  };
}

const AVATAR_COLORS = ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet', 'teal', 'orange'];

export async function createUser(input: {
  email: string; password: string; fullName: string; role?: Role; batch?: string | null;
}): Promise<AuthUser> {
  const conn = db();
  const existing = conn.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(input.email);
  if (existing) throw new DuplicateEmailError(input.email);

  const hash = await hashPassword(input.password);
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const role: Role = input.role ?? 'student';

  const txn = conn.transaction(() => {
    const info = conn.prepare(
      'INSERT INTO users (email, password_hash, full_name, role, avatar_color) VALUES (?, ?, ?, ?, ?)',
    ).run(input.email.trim(), hash, input.fullName.trim(), role, color);
    const id = Number(info.lastInsertRowid);
    // Every account gets a student profile so admins can practise too.
    conn.prepare('INSERT INTO students (user_id, batch) VALUES (?, ?)').run(id, input.batch ?? null);
    return id;
  });

  const id = txn();
  return findUserById(id)!;
}

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`An account already exists for ${email}.`);
    this.name = 'DuplicateEmailError';
  }
}

// ---------------------------------------------------------- middleware

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const query = req.query.token;
  return typeof query === 'string' ? query : null;
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    return;
  }
  const user = findUserById(Number(payload.sub));
  if (!user) {
    res.status(401).json({ error: 'Account not found or disabled.' });
    return;
  }
  req.user = user;
  next();
}

/** Attaches the user when a token is present, but never rejects. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) req.user = findUserById(Number(payload.sub)) ?? undefined;
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'You do not have access to this area.' });
      return;
    }
    next();
  };
}

export const requireAdmin = requireRole('admin', 'teacher');
