import { useEffect, useState } from "react";
import { api, clearToken, getToken, setToken } from "./api.js";
import { LogoDial } from "./components.jsx";
import Login from "./pages/Login.jsx";
import Overview from "./pages/Overview.jsx";
import Knowledge from "./pages/Knowledge.jsx";
import Projects from "./pages/Projects.jsx";
import Ask from "./pages/Ask.jsx";
import Docs from "./pages/Docs.jsx";
import Landing from "./pages/Landing.jsx";

const PAGES = [
  { id: "overview", label: "Overview", component: Overview },
  { id: "ask", label: "Ask AI", component: Ask },
  { id: "knowledge", label: "Knowledge", component: Knowledge },
  { id: "projects", label: "Projects", component: Projects },
  { id: "docs", label: "Get started", component: Docs }
];

const currentPage = () => {
  const id = window.location.hash.replace("#/", "");
  return PAGES.some((page) => page.id === id) ? id : "overview";
};

export default function App() {
  const [user, setUser] = useState(null);
  const params = new URLSearchParams(window.location.search);
  const linkToken = /^[a-f0-9]{64}$/.test(params.get("verify") || "") ? params.get("verify") : null;
  const [checking, setChecking] = useState(Boolean(getToken()) || Boolean(linkToken));
  const [linkError, setLinkError] = useState("");
  const [page, setPage] = useState(currentPage());
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onHash = () => {
      setPage(currentPage());
      setHash(window.location.hash); // logged-out routes (#/, #/docs, #/login) are not in PAGES
    };
    const onLogout = () => setUser(null);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("devvault:logout", onLogout);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("devvault:logout", onLogout);
    };
  }, []);

  useEffect(() => {
    // One-click link from the verification email: /?verify=<token>
    if (linkToken) {
      api("POST", "/api/auth/verify-email", { token: linkToken })
        .then((data) => { setToken(data.token); setUser(data.user); })
        .catch((err) => setLinkError(err.message))
        .finally(() => {
          window.history.replaceState({}, "", window.location.pathname + window.location.hash);
          setChecking(false);
        });
      return;
    }

    if (!getToken()) return;
    api("GET", "/api/me")
      .then((data) => setUser(data.user))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="splash">Opening the vault…</div>;
  if (!user) {
    const route = hash.replace(/^#\/?/, "");
    const publicPage = route === "docs" ? <Docs /> : route === "" || route === "landing" ? <Landing /> : null;

    if (!publicPage) {
      return <Login key={route} onAuth={setUser} initialError={linkError} initialMode={route === "register" ? "register" : "login"} />;
    }

    return (
      <div className="public-shell">
        <header className="public-nav">
          <a className="brand" href="#/"><LogoDial /> <span>DevVault</span></a>
          <nav className="public-links">
            <a href="#/docs">Install guide</a>
            <a className="btn primary small" href="#/login">Sign in</a>
          </nav>
        </header>
        <main className="public-main">{publicPage}</main>
        <footer className="public-footer">DevVault · your developer memory · <a href="#/docs">Install guide</a></footer>
      </div>
    );
  }

  const Page = PAGES.find((p) => p.id === page).component;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><LogoDial /> <span>DevVault</span></div>
        <nav>
          {PAGES.map((p) => (
            <a key={p.id} href={`#/${p.id}`} className={`key ${p.id === page ? "active" : ""}`}>
              <span className="led" /> {p.label}
            </a>
          ))}
        </nav>
        <div className="nameplate">
          <div className="account-name">{user.name}</div>
          <div className="account-email">{user.email}</div>
          <button className="btn small" onClick={() => { clearToken(); setUser(null); }}>Log out</button>
        </div>
      </aside>
      <main className="content"><Page /></main>
    </div>
  );
}
