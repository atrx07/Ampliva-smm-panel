import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth';

// This config is public by design (Firebase web configs are meant to ship
// in client code): it only identifies the project. Nothing here is a
// secret — sign-ins are gated by the authorized-domains list in the
// Firebase console plus server-side ID-token verification in the Worker.
const firebaseConfig = {
  apiKey: 'AIzaSyCqCYriovYLsv5PZmi6M1m7ywWl8YFaVio',
  authDomain: 'ampliva-25036.firebaseapp.com',
  projectId: 'ampliva-25036',
  storageBucket: 'ampliva-25036.firebasestorage.app',
  messagingSenderId: '207328059307',
  appId: '1:207328059307:web:5335b5e9e02de3fd903cee',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

/** Opens the Google sign-in popup and returns a Firebase ID token for the Worker. */
export async function signInWithGoogleIdToken(): Promise<string> {
  const credential = await signInWithPopup(auth, googleProvider);
  return credential.user.getIdToken();
}

/** Creates a Firebase email account and sends its verification link. */
export async function firebaseCreateVerifiedAccount(email: string, password: string): Promise<void> {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(credential.user);
}

/**
 * Signs in with a Firebase email account. Returns an ID token only when the
 * email is already verified; otherwise the caller shows the pending view.
 */
export async function firebaseSignInVerified(email: string, password: string): Promise<{ idToken: string | null; verified: boolean }> {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  if (!credential.user.emailVerified) return { idToken: null, verified: false };
  return { idToken: await credential.user.getIdToken(), verified: true };
}

/**
 * After the user clicks the verification link: refreshes the Firebase user
 * (signing in first when the session is gone) and returns an ID token, or
 * throws 'not-verified' when the link hasn't been clicked yet.
 */
export async function firebaseContinueAfterVerification(email: string, password: string): Promise<string> {
  let user = auth.currentUser;
  if (!user) user = (await signInWithEmailAndPassword(auth, email, password)).user;
  else await user.reload();
  if (!user.emailVerified) throw new Error('not-verified');
  // Force a fresh token: claims (including email_verified) are stamped at
  // mint time, so the cached token from signup still says unverified even
  // after reload() confirms the email is verified. A plain getIdToken()
  // returns that stale token and the Worker rightly rejects it.
  return user.getIdToken(true);
}

/** Re-sends the verification link to the signed-in (or just-signed-in) user. */
export async function firebaseResendVerification(email: string, password: string): Promise<void> {
  let user = auth.currentUser;
  if (!user) user = (await signInWithEmailAndPassword(auth, email, password)).user;
  await sendEmailVerification(user);
}

/** Sends a Firebase password-reset link to the address. */
export async function firebaseSendPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}

/** Friendly text for the Firebase errors users can actually hit. */
export function firebaseErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code ?? '';
  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Log in instead.';
    case 'auth/invalid-credential':
      return 'Wrong email or password.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again later.';
    case 'auth/user-not-found':
      return 'No account with this email.';
    default:
      return err instanceof Error ? err.message : 'Something went wrong';
  }
}
