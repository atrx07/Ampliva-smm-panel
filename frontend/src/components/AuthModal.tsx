import { useState } from 'react';
import { firebaseLogin, login, setToken } from '../api';
import {
  firebaseContinueAfterVerification,
  firebaseCreateVerifiedAccount,
  firebaseErrorMessage,
  firebaseResendVerification,
  firebaseSendPasswordReset,
  firebaseSignInVerified,
  signInWithGoogleIdToken,
} from '../lib/firebase';
import type { AuthUser } from '../types';

export function AuthModal({ onClose, onAuthed }: { onClose: () => void; onAuthed: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [firebaseStep, setFirebaseStep] = useState<'form' | 'pending'>('form');

  function switchMode(next: 'login' | 'register') {
    setMode(next);
    setError(null);
    setInfo(null);
    setFirebaseStep('form');
  }

  // Normal login: try the local account first, then fall back to the email
  // account (Firebase). An account created through signup has no local
  // password, so the local attempt 401s by design and the fallback signs
  // it in; a half-finished signup (link not clicked yet) lands on the
  // inbox-confirmation step instead. Failures stay generic so the form
  // never reveals which store an email belongs to.
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await login(email, password);
      setToken(result.token);
      onAuthed(result.user);
    } catch {
      try {
        const { idToken, verified } = await firebaseSignInVerified(email, password);
        if (!verified) {
          setFirebaseStep('pending');
          return;
        }
        const result = await firebaseLogin(idToken as string);
        setToken(result.token);
        onAuthed(result.user);
      } catch {
        setError('Email or password is incorrect.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function googleSignIn() {
    setBusy(true);
    setError(null);
    try {
      const idToken = await signInWithGoogleIdToken();
      const result = await firebaseLogin(idToken);
      setToken(result.token);
      onAuthed(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function firebaseCreate() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await firebaseCreateVerifiedAccount(email, password);
      setFirebaseStep('pending');
    } catch (err) {
      setError(firebaseErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function firebaseContinue() {
    setBusy(true);
    setError(null);
    try {
      const idToken = await firebaseContinueAfterVerification(email, password);
      const result = await firebaseLogin(idToken);
      setToken(result.token);
      onAuthed(result.user);
    } catch (err) {
      setError(err instanceof Error && err.message === 'not-verified' ? 'Not confirmed yet — click the link in your inbox first, then try again.' : firebaseErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function firebaseResend() {
    setBusy(true);
    setError(null);
    try {
      await firebaseResendVerification(email, password);
      setInfo('Confirmation link re-sent. Check your inbox.');
    } catch (err) {
      setError(firebaseErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function firebaseReset() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await firebaseSendPasswordReset(email);
      setInfo('Password reset link sent. Check your inbox.');
    } catch (err) {
      setError(firebaseErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {firebaseStep === 'pending' ? (
          <>
            <h3>Check your inbox</h3>
            <div className="form-stack">
              <div className="notice">Confirmation link sent to {email}. Click the link in your inbox, then continue below. Can’t find it? Check your spam folder too — mails from a new sender sometimes land there.</div>
              {info && <div className="notice">{info}</div>}
              {error && <div className="notice error">{error}</div>}
              <button className="primary-button full" type="button" disabled={busy} onClick={firebaseContinue}>{busy ? 'Please wait…' : 'Continue'}</button>
              <button className="ghost-button auth-google" type="button" disabled={busy} onClick={firebaseResend}>Resend link</button>
              <button className="link-button" type="button" onClick={() => switchMode('login')}>Back to log in</button>
            </div>
          </>
        ) : mode === 'register' ? (
          <>
            <h3>Create your account</h3>
            <p className="modal-sub">One account for your wallet, orders and tracking.</p>
            <form onSubmit={(e) => e.preventDefault()} className="form-stack">
              <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
              <label>Password<input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" /></label>
              {info && <div className="notice">{info}</div>}
              {error && <div className="notice error">{error}</div>}
              <button className="primary-button full" type="button" disabled={busy} onClick={firebaseCreate}>{busy ? 'Please wait…' : 'Create account'}</button>
            </form>
            <button className="ghost-button auth-google" type="button" disabled={busy} onClick={googleSignIn}>Continue with Google</button>
            <p className="modal-sub">Google sign-in links to your existing account when the email matches.</p>
            <button className="link-button" onClick={() => switchMode('login')}>Already have an account? Log in</button>
          </>
        ) : (
          <>
            <h3>Welcome back</h3>
            <p className="modal-sub">One account for your wallet, orders and tracking.</p>
            <form onSubmit={submit} className="form-stack">
              <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
              <label>Password<input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" /></label>
              {info && <div className="notice">{info}</div>}
              {error && <div className="notice error">{error}</div>}
              <button className="primary-button full" type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Log in'}</button>
            </form>
            <button className="ghost-button auth-google" type="button" disabled={busy} onClick={googleSignIn}>Continue with Google</button>
            <p className="modal-sub">Google sign-in links to your existing account when the email matches.</p>
            <button className="link-button" onClick={() => switchMode('register')}>New here? Create an account</button>
            <button className="link-button" type="button" disabled={busy || !email} onClick={firebaseReset}>Forgot password?</button>
          </>
        )}
      </div>
    </div>
  );
}
