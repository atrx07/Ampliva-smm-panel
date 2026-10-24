import { useState } from 'react';
import { login, register, setToken } from '../api';
import type { AuthUser } from '../types';

export function AuthModal({ onClose, onAuthed }: { onClose: () => void; onAuthed: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = mode === 'register' ? await register(email, password) : await login(email, password);
      setToken(result.token);
      onAuthed(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{mode === 'register' ? 'Create your account' : 'Welcome back'}</h3>
        <p className="modal-sub">One account for your wallet, orders and tracking.</p>
        <form onSubmit={submit} className="form-stack">
          <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
          <label>Password<input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" /></label>
          {error && <div className="notice error">{error}</div>}
          <button className="primary-button full" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Sign up' : 'Log in'}</button>
        </form>
        <button className="link-button" onClick={() => setMode(mode === 'register' ? 'login' : 'register')}>
          {mode === 'register' ? 'Already have an account? Log in' : 'New here? Create an account'}
        </button>
      </div>
    </div>
  );
}
