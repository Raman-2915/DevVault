import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";

export default function Knowledge() {
  const [filters, setFilters] = useState({ q: "", type: "", project: "", tag: "" });
  const [semantic, setSemantic] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pages: 1 });
  const [facets, setFacets] = useState({ byType: [], byProject: [] });
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api("GET", "/api/stats").then((s) => setFacets({ byType: s.byType, byProject: s.byProject })).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      if (semantic && filters.q.trim()) {
        const { results } = await api("POST", "/api/search", { query: filters.q, type: filters.type, project: filters.project, limit: 20 });
        setData({ items: results, total: results.length, pages: 1 });
      } else {
        const params = new URLSearchParams({ page, limit: 15 });
        Object.entries(filters).forEach(([key, value]) => value && params.set(key, value));
        setData(await api("GET", `/api/knowledge?${params}`));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters, semantic, page]);

  useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [load]);

  const setFilter = (key) => (event) => {
    setPage(1);
    setFilters({ ...filters, [key]: event.target.value });
  };

  async function remove(entry) {
    if (!window.confirm(`Delete "${entry.title}" from the cloud? (Your local copy is not touched.)`)) return;

    try {
      await api("DELETE", `/api/knowledge/${encodeURIComponent(entry.id)}`);
      setSelected(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <h1>Knowledge</h1>

      <div className="toolbar">
        <input className="grow" placeholder={semantic ? "Describe what you’re looking for…" : "Filter by keyword…"} value={filters.q} onChange={setFilter("q")} />
        <select value={filters.type} onChange={setFilter("type")}>
          <option value="">All types</option>
          {facets.byType.map((t) => <option key={t.name} value={t.name}>{t.name} ({t.count})</option>)}
        </select>
        <select value={filters.project} onChange={setFilter("project")}>
          <option value="">All projects</option>
          {facets.byProject.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.count})</option>)}
        </select>
        <label className="toggle">
          <input type="checkbox" className="switch" checked={semantic} onChange={(e) => { setSemantic(e.target.checked); setPage(1); }} />
          <span>Semantic</span>
        </label>
      </div>

      {filters.tag && (
        <div className="active-tag">
          Tag: <span className="tag">{filters.tag}</span>
          <button className="link" onClick={() => setFilters({ ...filters, tag: "" })}>clear</button>
        </div>
      )}

      {error && <div className="alert">{error}</div>}
      {loading && <p className="muted">Loading…</p>}
      {!loading && data.items.length === 0 && !error && <p className="muted">No entries match.</p>}

      <div className="list">
        {data.items.map((item) => (
          <button key={item.id} className="row" onClick={() => setSelected(item)}>
            <div className="row-title">{item.title}</div>
            <div className="row-meta">
              <span className="pill">{item.type}</span>
              {item.project && <span className="muted">{item.project}</span>}
              {item.matchedBy && <span className={`pill ${item.matchedBy}`}>{item.matchedBy} {Math.round(item.score * 100)}%</span>}
            </div>
          </button>
        ))}
      </div>

      {data.pages > 1 && (
        <div className="pager">
          <button className="btn ghost small" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
          <span className="muted">Page {page} of {data.pages} · {data.total} entries</span>
          <button className="btn ghost small" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}

      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <aside className="drawer" onClick={(event) => event.stopPropagation()}>
            <button className="link close" onClick={() => setSelected(null)}>Close ✕</button>
            <h2>{selected.title}</h2>
            <div className="row-meta">
              <span className="pill">{selected.type}</span>
              {selected.project && <span className="muted">{selected.project}</span>}
            </div>
            {selected.sourceFile && <p className="muted small">{selected.sourceFile}{selected.sourceLine ? `:${selected.sourceLine}` : ""}</p>}
            <pre className="content-box">{selected.content}</pre>
            <div className="tags">
              {(selected.tags || []).map((tag) => (
                <button key={tag} className="tag" onClick={() => { setFilters({ ...filters, tag }); setSemantic(false); setSelected(null); setPage(1); }}>{tag}</button>
              ))}
            </div>
            <button className="btn danger" onClick={() => remove(selected)}>Delete from cloud</button>
          </aside>
        </div>
      )}
    </>
  );
}
