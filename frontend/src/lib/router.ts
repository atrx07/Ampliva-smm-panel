import { useCallback, useEffect, useState } from 'react';

// Tiny path-based router (no dependency). Cloudflare Pages serves index.html
// for every path (see public/_redirects), so deep links like /store survive
// refreshes and shared links.
export function currentPath(): string {
  const p = window.location.pathname;
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

export function useRoute(): [string, (path: string) => void] {
  const [route, setRoute] = useState(currentPath());

  useEffect(() => {
    const sync = () => setRoute(currentPath());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const navigate = useCallback((path: string) => {
    if (path !== window.location.pathname) window.history.pushState(null, '', path);
    setRoute(currentPath());
    window.scrollTo(0, 0);
  }, []);

  return [route, navigate];
}
