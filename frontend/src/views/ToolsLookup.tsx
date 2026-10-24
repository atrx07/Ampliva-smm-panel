import { useState } from 'react';
import { lookupProfile } from '../api';
import { formatNumber } from '../lib/format';
import type { ProfileResult } from '../types';

// Instagram Tools, tool 1: Profile Lookup. Surface data only — whatever
// Instagram makes publicly accessible for the account, private or public.
// Nothing here digs up non-visible content.
function cleanUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '');
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
          src={profile.avatar}
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
            {profile.recentPosts.map((post) => (
              <a
                key={post.shortcode}
                className="lookup-post"
                href={`https://www.instagram.com/p/${post.shortcode}/`}
                target="_blank"
                rel="noreferrer"
                title={post.caption || 'Instagram post'}
              >
                <img src={post.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
                <span className="lookup-post-counts">
                  ♥ {post.likes !== null ? formatNumber(post.likes) : '—'}
                  {' '}💬 {post.comments !== null ? formatNumber(post.comments) : '—'}
                </span>
              </a>
            ))}
          </div>
        </>
      ) : (
        <p className="modal-sub">No recent posts are publicly visible for this account.</p>
      )}
    </article>
  );
}

export function ToolsLookup() {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileResult | null>(null);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    const username = cleanUsername(input);
    if (!username) {
      setError('Type an Instagram username first.');
      setStatus('error');
      return;
    }
    setStatus('loading');
    setError(null);
    setProfile(null);
    try {
      setProfile(await lookupProfile(username));
      setStatus('done');
    } catch (err) {
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
        is what Instagram makes publicly accessible.
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
