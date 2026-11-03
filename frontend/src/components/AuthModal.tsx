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
  const [mode, setMode] = useState<'login' | 'firebase'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [firebaseStep, setFirebaseStep] = useState<'form' | 'pending'>('form');

  function switchMode(next: 'login' | 'firebase') {
    setMode(next);
    setError(null);
    setInfo(null);
    setFirebaseStep('form');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await login(email, password);
      setToken(result.token);
      onAuthed(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
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

  async function firebaseLoginFlow() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const { idToken, verified } = await firebaseSignInVerified(email, password);
      if (!verified) {
        setFirebaseStep('pending');
        return;
      }
      const result = await firebaseLogin(idToken as string);
      setToken(result.token);
      onAuthed(result.user);
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
      setError(err instanceof Error && err.message === 'not-verified' ? 'Not verified yet — click the link in your inbox first, then try again.' : firebaseErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function firebaseResend() {
    setBusy(true);
    setError(null);
    try {
      await firebaseResendVerification(email, password);
      setInfo('Verification link re-sent. Check your inbox.');
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
        {mode === 'firebase' ? (
          <>
            <h3>Verified email</h3>
            <p className="modal-sub">Sign up or log in with an email address you verify. A verified sign-in links to your existing account when the email matches.</p>
            {firebaseStep === 'pending' ? (
              <div className="form-stack">
                <div className="notice">Verification link sent to {email}. Click the link in your inbox, then continue below. Can’t find it? Check your spam folder too — verification mails from a new sender sometimes land there.</div>
                {info && <div className="notice">{info}</div>}
                {error && <div className="notice error">{error}</div>}
                <button className="primary-button full" type="button" disabled={busy} onClick={firebaseContinue}>{busy ? 'Please wait…' : 'I’ve verified — continue'}</button>
                <button className="ghost-button auth-google" type="button" disabled={busy} onClick={firebaseResend}>Resend link</button>
                <button className="link-button" type="button" onClick={() => switchMode('login')}>Back to password login</button>
              </div>
            ) : (
              <form onSubmit={(e) => e.preventDefault()} className="form-stack">
                <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
                <label>Password<input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" /></label>
                {info && <div className="notice">{info}</div>}
                {error && <div className="notice error">{error}</div>}
                <button className="primary-button full" type="button" disabled={busy} onClick={firebaseCreate}>{busy ? 'Please wait…' : 'Create verified account'}</button>
                <button className="ghost-button auth-google" type="button" disabled={busy} onClick={firebaseLoginFlow}>Log in with verified email</button>
                <button className="link-button" type="button" disabled={busy || !email} onClick={firebaseReset}>Forgot password?</button>
                <button className="link-button" type="button" onClick={() => switchMode('login')}>Back to password login</button>
              </form>
            )}
          </>
        ) : (
          <>
            <h3>Welcome back</h3>
            <p className="modal-sub">One account for your wallet, orders and tracking.</p>
            <form onSubmit={submit} className="form-stack">
              <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
              <label>Password<input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" /></label>
              {error && <div className="notice error">{error}</div>}
              <button className="primary-button full" type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Log in'}</button>
            </form>
            <button className="ghost-button auth-google" type="button" disabled={busy} onClick={googleSignIn}>Continue with Google</button>
            <p className="modal-sub">Google sign-in links to your existing account when the email matches.</p>
            <button className="link-button" onClick={() => switchMode('firebase')}>New here? Create a verified account</button>
          </>
        )}
      </div>
    </div>
  );
}
