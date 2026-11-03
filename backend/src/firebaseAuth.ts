/**
 * Verify a Firebase Auth ID token (RS256 JWT) without the Admin SDK, which
 * needs Node APIs that don't run on Workers. We fetch Google's JWKS for
 * securetoken, import the matching RSA key with WebCrypto, and check the
 * signature plus the claims that bind the token to this project. The result
 * is only an identity proof: the Worker still mints its own local session,
 * so every existing endpoint keeps working unchanged.
 *
 * Lesson (2026-11-04): the x509 certs endpoint returns full X.509
 * certificates, not bare public keys — importing one as 'spki' throws, so
 * the key list came up empty and every real token 401'd even though the
 * Google consent half had already succeeded. The JWKS endpoint returns the
 * keys directly in JWK form, which WebCrypto imports as-is.
 */

const FIREBASE_PROJECT_ID = 'ampliva-25036';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;

interface FirebaseClaims {
  iss: string;
  aud: string;
  exp: number;
  sub: string;
  email?: string;
  email_verified?: boolean;
}

interface Jwk {
  kty?: string;
  kid?: string;
  n?: string;
  e?: string;
}

let cachedKeys: { keys: Map<string, CryptoKey>; fetchedAt: number } | null = null;

async function getKey(kid: string): Promise<CryptoKey | null> {
  const stale = !cachedKeys || Date.now() - cachedKeys.fetchedAt > 60 * 60 * 1000;
  if (stale || !cachedKeys!.keys.has(kid)) {
    try {
      const res = await fetch(JWKS_URL);
      if (!res.ok) return null;
      const json = (await res.json()) as { keys?: Jwk[] };
      const keys = new Map<string, CryptoKey>();
      for (const jwk of json.keys ?? []) {
        if (jwk.kty !== 'RSA' || !jwk.kid || !jwk.n || !jwk.e) continue;
        try {
          keys.set(
            jwk.kid,
            await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']),
          );
        } catch {
          // Skip keys that don't import; the matching kid is what matters.
        }
      }
      cachedKeys = { keys, fetchedAt: Date.now() };
    } catch {
      return null;
    }
  }
  const certs = cachedKeys;
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
