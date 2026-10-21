import type { Context } from 'hono';
import type { Env, UserRow } from './types';

// --- small crypto helpers (WebCrypto, Workers-native) ---

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function randomHex(byteLength: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export function newId(prefix: string): string {
  return `${prefix}_${randomHex(12)}`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}

const PBKDF2_ITERATIONS = 100_000;

export async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return { hash: toHex(new Uint8Array(bits)), salt: toHex(salt) };
}

export async function verifyPassword(password: string, saltHex: string, expectedHash: string): Promise<boolean> {
  const { hash } = await hashPassword(password, saltHex);
  if (hash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  return diff === 0;
}

// --- sessions ---

export interface AuthedUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
}

export async function createSession(db: D1Database, userId: string, ttlDays: number): Promise<string> {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const expires = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
  await db
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, userId, now.toISOString(), expires.toISOString())
    .run();
  return token;
}

export async function destroySession(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
}

export function bearerToken(c: Context<{ Bindings: Env }>): string | null {
  const header = c.req.header('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function getAuthedUser(c: Context<{ Bindings: Env }>): Promise<AuthedUser | null> {
  if (!c.env.DB) return null;
  const token = bearerToken(c);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await c.env.DB
    .prepare(
      `SELECT u.id AS id, u.email AS email, u.role AS role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(tokenHash, new Date().toISOString())
    .first<AuthedUser>();
  return row ?? null;
}

export async function requireAuth(c: Context<{ Bindings: Env }>): Promise<AuthedUser | Response> {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Login required' }, 401);
  return user;
}

export async function requireAdmin(c: Context<{ Bindings: Env }>): Promise<AuthedUser | Response> {
  const user = await requireAuth(c);
  if (user instanceof Response) return user;
  if (user.role !== 'admin') return c.json({ error: 'Admin access required' }, 403);
  return user;
}

export function isResponse(value: AuthedUser | Response): value is Response {
  return value instanceof Response;
}

export type { UserRow };
