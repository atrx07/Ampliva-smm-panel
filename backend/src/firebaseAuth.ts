/**
 * Verify a Firebase Auth ID token (RS256 JWT) without the Admin SDK, which
 * needs Node APIs that don't run on Workers. We fetch Google's public certs
 * for securetoken, import the matching key with WebCrypto, and check the
 * signature plus the claims that bind the token to this project. The result
 * is only an identity proof: the Worker still mints its own local session,
 * so every existing endpoint keeps working unchanged.
 */

const FIREBASE_PROJECT_ID = 'ampliva-25036';
const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;

interface FirebaseClaims {
  iss: string;
  aud: string;
  exp: number;
  sub: string;
  email?: string;
  email_verified?: boolean;
}

let cachedCerts: { keys: Map<string, CryptoKey>; fetchedAt: number } | null = null;

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function getKey(kid: string): Promise<CryptoKey | null> {
  const stale = !cachedCerts || Date.now() - cachedCerts.fetchedAt > 60 * 60 * 1000;
  if (stale || !cachedCerts!.keys.has(kid)) {
    try {
      const res = await fetch(CERTS_URL);
      if (!res.ok) return null;
      const json = (await res.json()) as Record<string, string>;
      const keys = new Map<string, CryptoKey>();
      for (const [id, pem] of Object.entries(json)) {
        try {
          keys.set(id, await crypto.subtle.importKey('spki', pemToDer(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
        } catch {
          // Skip certs that don't parse; the matching kid is what matters.
        }
      }
      cachedCerts = { keys, fetchedAt: Date.now() };
    } catch {
      return null;
    }
  }
  const certs = cachedCerts;
  if (!certs) return null;
  return certs.keys.get(kid) ?? null;
}

function b64urlDecode(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

function b64urlToBytes(input: string): Uint8Array {
  const str = b64urlDecode(input);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

/** Returns the verified Firebase UID + email, or null when anything fails. */
export async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; email: string } | null> {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(b64urlDecode(parts[0])) as { kid?: string; alg?: string };
    if (header.alg !== 'RS256' || !header.kid) return null;
    const key = await getKey(header.kid);
    if (!key) return null;
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]) as BufferSource, data as BufferSource);
    if (!ok) return null;
    const claims = JSON.parse(b64urlDecode(parts[1])) as FirebaseClaims;
    if (claims.iss !== ISSUER || claims.aud !== FIREBASE_PROJECT_ID) return null;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return null;
    // email_verified is the gate that makes this safe to link by email: a
    // Google sign-in is verified by Google, and a Firebase email signup is
    // verified only after the user clicks the confirmation mail.
    if (!claims.sub || !claims.email || claims.email_verified !== true) return null;
    return { uid: claims.sub, email: claims.email.trim().toLowerCase() };
  } catch {
    return null;
  }
}
