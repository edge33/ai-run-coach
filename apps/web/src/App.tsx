import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { useStatus } from './api.ts';
import { ErrorNotice } from './components.tsx';
import { Overview } from './Overview.tsx';
import { RunDetails } from './RunDetails.tsx';
import { Runs } from './Runs.tsx';
import { Synchronization } from './Synchronization.tsx';
import { useSyncProgress } from './useSyncProgress.ts';

const Health = lazy(() => import('./Health.tsx'));
export function App() {
  const status = useStatus();
  const client = useQueryClient();
  const activeId = status.data?.active?.id;
  const { streamError } = useSyncProgress(activeId);
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-icon" aria-hidden="true">
            ↗
          </span>
          stride<span className="brand-dot">.</span>
        </Link>
        <p className="eyebrow">YOUR RUNNING NOTEBOOK</p>
        <nav aria-label="Main navigation">
          {[
            ['/', 'Overview', '◉'],
            ['/runs', 'Runs', '↗'],
            ['/health', 'Health', '♡'],
            ['/sync', 'Synchronization', '↻'],
          ].map(([to, name, icon]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <span aria-hidden="true">{icon}</span>
              {name}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="status-dot" />
          Personal data, at your pace
          <p>
            Manual imports. Your records.
            <br />A clearer view of every run.
          </p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>RUNNING DATA HUB</span>
          <div>
            <span className="status-dot" />
            {status.data?.timezone ?? 'Local workspace'}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                void client.invalidateQueries();
              }}
            >
              Refresh view
            </button>
          </div>
        </header>
        <main>
          <ErrorNotice error={status.error} />
          {activeId ? (
            <div className="notice">
              Synchronization in progress. <Link to="/sync">View progress →</Link>
            </div>
          ) : null}
          {streamError && activeId ? (
            <p className="notice">
              Progress connection interrupted. Reconnecting; synchronization continues on the
              server.
            </p>
          ) : null}
          <Suspense fallback={<p role="status">Loading view…</p>}>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/runs" element={<Runs />} />
              <Route path="/runs/:id" element={<RunDetails />} />
              <Route path="/health" element={<Health />} />
              <Route path="/sync" element={<Synchronization />} />
              <Route
                path="*"
                element={
                  <p>
                    Page not found. <Link to="/">Return to overview</Link>
                  </p>
                }
              />
            </Routes>
          </Suspense>
        </main>
        <footer>Built around what you recorded. Nothing assumed.</footer>
      </div>
    </div>
  );
}
