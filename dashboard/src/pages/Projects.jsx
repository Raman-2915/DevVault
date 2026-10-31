import { useEffect, useState } from "react";
import { api } from "../api.js";

const Chips = ({ label, items }) =>
  items?.length ? (
    <div className="chips-row">
      <span className="chips-label">{label}</span>
      {items.slice(0, 10).map((item) => <span className="tag static" key={item}>{item}</span>)}
    </div>
  ) : null;

export default function Projects() {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("GET", "/api/projects").then((d) => setProjects(d.projects)).catch((e) => setError(e.message));
  }, []);

  async function remove(project) {
    if (!window.confirm(`Delete "${project.name}" and its ${project.entryCount} knowledge entries from your account? (Files on your computer are not touched.)`)) return;

    try {
      await api("DELETE", `/api/projects/${encodeURIComponent(project.id)}`);
      setProjects((list) => list.filter((p) => p.id !== project.id));
    } catch (err) {
      setError(err.message);
    }
  }

  if (error) return <div className="alert">{error}</div>;
  if (!projects) return <p className="muted">Loading…</p>;

  return (
    <>
      <h1>Projects</h1>
      {projects.length === 0 && <p className="muted">No projects synced yet. Run <code>devvault analyze</code> then <code>devvault sync</code>.</p>}

      <div className="grid-2">
        {projects.map((project) => (
          <section className="card" key={project.id}>
            <h3>{project.name}</h3>
            <p className="muted small">
              {project.entryCount} knowledge entries
              {project.analyzedAt ? ` · analyzed ${new Date(project.analyzedAt).toLocaleDateString()}` : ""}
            </p>
            {project.summary && <p>{project.summary}</p>}
            <Chips label="Languages" items={project.languages} />
            <Chips label="Frameworks" items={project.frameworks} />
            <Chips label="Databases" items={project.databases} />
            <Chips label="Auth" items={project.authenticationLibraries} />
            <Chips label="Architecture" items={project.architecture} />
            <button className="btn small danger" onClick={() => remove(project)}>Delete project</button>
          </section>
        ))}
      </div>
    </>
  );
}
