import { useRef, useState } from 'react';
import { pollLookup, proxyImageUrl, startLookup } from '../api';
import { formatNumber } from '../lib/format';
import type { ProfileResult } from '../types';

// Instagram Tools, tool 1: Profile Lookup. Surface data only — whatever
// the provider returns for the account's public surface, private or public.
// Nothing here digs up non-visible content. Lookups run through Apify's
// Instagram Profile Scraper (no Instagram session is held anywhere) and
// results are cached for 24h, so repeat lookups cost nothing.
function cleanUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="lookup-stat">
      <strong title={String(value)}>{formatNumber(value)}</strong>
      <span>{label}</span>
    </div>
  );
}

function ProfileCard({ profile }: { profile: ProfileResult }) {
  return (
    <article className="panel lookup-card">
      <div className="lookup-head">
        <img
          className="lookup-avatar"
          src={proxyImageUrl(profile.avatar)}
          alt={`${profile.username}'s profile picture`}
          referrerPolicy="no-referrer"
        />
        <div>
          <div className="lookup-name">
            <strong>{profile.fullName || profile.username}</strong>
            {profile.isVerified && <span className="lookup-verified" title="Verified">✓</span>}
          </div>
          <div className="muted">@{profile.username}</div>
          <div className="lookup-badges">
            <span className={`lookup-badge ${profile.isPrivate ? 'private' : 'public'}`}>
              {profile.isPrivate ? 'Private account' : 'Public account'}
            </span>
            {profile.category && <span className="lookup-badge">{profile.category}</span>}
            {profile.cached && <span className="lookup-badge">Cached result</span>}
          </div>
        </div>
      </div>

      {profile.bio && <p className="lookup-bio">{profile.bio}</p>}
      {profile.website && (
        <a className="lookup-website" href={profile.website} target="_blank" rel="noreferrer">
          {profile.website}
        </a>
      )}

      <div className="lookup-stats">
        <Stat value={profile.posts} label="Posts" />
        <Stat value={profile.followers} label="Followers" />
        <Stat value={profile.following} label="Following" />
      </div>

      {profile.isPrivate ? (
        <p className="modal-sub">
          This account is private, so its posts are hidden to non-followers.
          Everything above is its public surface — nothing more is shown, or faked.
        </p>
      ) : profile.recentPosts.length > 0 ? (
        <>
          <h3>Recent posts</h3>
          <div className="lookup-posts">
            {profile.recentPosts.map((post, i) => {
              const inner = (
                <>
                  {post.thumbnail ? (
                    <img src={proxyImageUrl(post.thumbnail)} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="lookup-post-text">{post.caption || post.shortcode || 'Post'}</span>
                  )}
                  <span className="lookup-post-counts">
                    ♥ {post.likes !== null ? formatNumber(post.likes) : '—'}
                    {' '}💬 {post.comments !== null ? formatNumber(post.comments) : '—'}
                  </span>
                </>
              );
              return post.url ? (
                <a
                  key={post.shortcode || `${post.url}-${i}`}
                  className="lookup-post"
                  href={post.url}
                  target="_blank"
                  rel="noreferrer"
                  title={post.caption || 'Instagram post'}
                >
                  {inner}
                </a>
              ) : (
                <span key={post.shortcode || `post-${i}`} className="lookup-post" title={post.caption || 'Instagram post'}>
                  {inner}
                </span>
              );
            })}
          </div>
        </>
      ) : (
        <p className="modal-sub">No recent posts are publicly visible for this account.</p>
      )}
    </article>
  );
}

const POLL_INTERVAL_MS = 3000;
const POLL_ATTEMPTS = 20;

export function ToolsLookup() {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'waiting' | 'error' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileResult | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const runToken = useRef(0);

  // Poll one Apify run until it finishes. Returns true when a profile was
  // delivered, false when the run is still going after all attempts — the
  // run id is kept so "keep waiting" resumes the SAME run, never a new one.
  async function poll(id: string, username: string, token: number): Promise<boolean> {
    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      await sleep(POLL_INTERVAL_MS);
      if (token !== runToken.current) return false;
      const result = await pollLookup(id, username);
      if ('status' in result && result.status === 'running') continue;
      if (token !== runToken.current) return false;
      setProfile(result as ProfileResult);
      setStatus('done');
      return true;
    }
    return false;
  }

  async function run(event: React.FormEvent) {
    event.preventDefault();
    const username = cleanUsername(input);
    if (!username) {
      setError('Type an Instagram username first.');
      setStatus('error');
      return;
    }
    const token = ++runToken.current;
    setStatus('loading');
    setError(null);
    setProfile(null);
    setRunId(null);
    try {
      const started = await startLookup(username);
      if (token !== runToken.current) return;
      if (!('status' in started)) {
        // Cache hit: the worker answered with a profile immediately.
        setProfile(started as ProfileResult);
        setStatus('done');
        return;
      }
      setRunId(started.runId);
      const finished = await poll(started.runId, username, token);
      if (!finished && token === runToken.current) {
        setStatus('waiting');
      }
    } catch (err) {
      if (token !== runToken.current) return;
      setError(err instanceof Error ? err.message : 'Lookup failed.');
      setStatus('error');
    }
  }

  async function keepWaiting() {
    if (!runId) return;
    const username = cleanUsername(input);
    if (!username) return;
    const token = runToken.current;
    setStatus('loading');
    setError(null);
    try {
      const finished = await poll(runId, username, token);
      if (!finished && token === runToken.current) {
        setStatus('waiting');
      }
    } catch (err) {
      if (token !== runToken.current) return;
      setError(err instanceof Error ? err.message : 'Lookup failed.');
      setStatus('error');
    }
  }

  return (
    <main className="dash">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Tools</div>
          <h2>Profile Lookup</h2>
        </div>
      </div>
      <p className="modal-sub">
        Surface stats for any Instagram profile — private or public, everything shown
        is what is publicly accessible. Results are cached for a day, so repeat
        lookups are instant.
      </p>

      <form className="lookup-form" onSubmit={run}>
        <label>
          Instagram username
          <div className="lookup-input-row">
            <span>@</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="ricoatmuse"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        </label>
        <button className="primary-button" type="submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'Looking up…' : 'Look up'}
        </button>
      </form>

      {status === 'loading' && (
        <p className="modal-sub">Running the lookup — this takes a few seconds while the provider fetches the profile.</p>
      )}
      {status === 'waiting' && (
        <div className="notice">
          Still running — the provider is taking longer than usual. Your search is
          still going; you can keep waiting without starting (or paying for) a new one.
          <div style={{ marginTop: 8 }}>
            <button className="primary-button" type="button" onClick={keepWaiting}>
              Keep waiting
            </button>
          </div>
        </div>
      )}
      {status === 'error' && error && <div className="notice error">{error}</div>}
      {status === 'done' && profile && <ProfileCard profile={profile} />}
      {status === 'idle' && (
        <p className="modal-sub">
          Try any public profile — or a private one, and see exactly what is (and isn't)
          visible on the surface.
        </p>
      )}
    </main>
  );
}
