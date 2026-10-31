import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Counter, Gauge } from "../components.jsx";

function BarList({ title, rows, empty = "Nothing yet" }) {
  const max = Math.max(1, ...rows.map((row) => row.count));

  return (
    <section className="card">
      <h3>{title}</h3>
      {rows.length === 0 && <p className="muted">{empty}</p>}
      {rows.slice(0, 8).map((row) => (
        <div className="bar-row" key={row.name}>
          <span className="bar-label" title={row.name}>{row.name}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(row.count / max) * 100}%` }} />
          </span>
          <span className="bar-count">{row.count}</span>
        </div>
      ))}
    </section>
  );
}

export default function Overview() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("GET", "/api/stats").then(setStats).catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="alert">{error}</div>;
  if (!stats) return <p className="muted">Loading…</p>;

  const { totals } = stats;
  const coverage = totals.entries ? Math.round((totals.embedded / totals.entries) * 100) : 0;

  return (
    <>
      <h1>Overview</h1>

      <div className="stat-grid">
        <Counter value={totals.projects} label="Projects analyzed" />
        <Counter value={totals.entries} label="Knowledge entries" />
        <Gauge percent={coverage} label="Semantic index" />
      </div>

      {totals.entries === 0 && (
        <div className="card empty">
          <h3>Your vault is empty</h3>
          <p className="muted">
            Run <code>devvault analyze &lt;path&gt;</code>, <code>devvault extract &lt;project-id&gt;</code> and{" "}
            <code>devvault sync</code> from your terminal, then refresh this page.
          </p>
        </div>
      )}

      {stats.technology && (stats.technology.databases.length > 0 || stats.technology.frameworks.length > 0) && (
        <div className="grid-2 tech-row">
          <BarList title="Databases across your projects" rows={stats.technology.databases} />
          <BarList title="Languages" rows={stats.technology.languages} />
          <BarList title="Frameworks" rows={stats.technology.frameworks} />
        </div>
      )}

      <div className="grid-2">
        <BarList title="Entries by project" rows={stats.byProject} />
        <BarList title="Entries by type" rows={stats.byType} />
        <BarList title="Top tags" rows={stats.topTags} />
        <section className="card">
          <h3>Recent searches</h3>
          {stats.recentSearches.length === 0 && <p className="muted">No searches yet.</p>}
          <ul className="plain">
            {stats.recentSearches.map((search, index) => (
              <li key={index}>
                <span className={`pill ${search.mode}`}>{search.mode}</span> {search.query}
                <span className="muted"> · {search.resultCount} results</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
