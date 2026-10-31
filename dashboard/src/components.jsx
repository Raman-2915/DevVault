import { useState } from "react";

// Small skeuomorphic building blocks (pure SVG/CSS, no dependencies).

export function LogoDial({ size = 34 }) {
  const ticks = Array.from({ length: 12 }, (_, i) => i * 30);

  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="logo-dial">
      <defs>
        <radialGradient id="ld-brass" cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset=".45" stopColor="#d4af5f" />
          <stop offset="1" stopColor="#7a5a1c" />
        </radialGradient>
        <radialGradient id="ld-face" cx="40%" cy="35%" r="75%">
          <stop offset="0" stopColor="#4a3a2c" />
          <stop offset="1" stopColor="#140e09" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="19" fill="url(#ld-brass)" />
      <circle cx="20" cy="20" r="15" fill="url(#ld-face)" />
      {ticks.map((deg) => (
        <line key={deg} x1="20" y1="7" x2="20" y2={deg % 90 === 0 ? 10.5 : 9} stroke="#e9cf93" strokeWidth={deg % 90 === 0 ? 1.4 : 0.8} transform={`rotate(${deg} 20 20)`} />
      ))}
      <line x1="20" y1="20" x2="20" y2="10.5" stroke="#ff7a59" strokeWidth="1.8" strokeLinecap="round" transform="rotate(48 20 20)" />
      <circle cx="20" cy="20" r="2.6" fill="url(#ld-brass)" />
    </svg>
  );
}

export function Screws() {
  return (
    <>
      <i className="screw tl" /><i className="screw tr" /><i className="screw bl" /><i className="screw br" />
    </>
  );
}

export function Counter({ value, label }) {
  const text = String(value);
  const width = Math.max(4, text.length);

  return (
    <div className="bezel">
      <div className="lcd">
        <span className="lcd-ghost" aria-hidden="true">{"8".repeat(width)}</span>
        <span className="lcd-value">{text.padStart(width, " ")}</span>
      </div>
      <div className="plate">{label}</div>
    </div>
  );
}

export function Gauge({ percent, label }) {
  const pct = Math.min(Math.max(percent, 0), 100);
  const angle = -90 + pct * 1.8;
  const ticks = Array.from({ length: 11 }, (_, i) => i * 10);

  return (
    <div className="bezel">
      <svg viewBox="0 0 200 120" className="gauge" role="img" aria-label={`${label}: ${pct}%`}>
        <defs>
          <linearGradient id="g-face" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fffdf3" />
            <stop offset="1" stopColor="#e6dcc0" />
          </linearGradient>
          <clipPath id="g-clip"><path d="M10 108 A90 90 0 0 1 190 108 Z" /></clipPath>
          <linearGradient id="g-glass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M10 108 A90 90 0 0 1 190 108 Z" fill="url(#g-face)" stroke="#8a7a58" strokeWidth="2" />
        <path d="M24 108 A76 76 0 0 1 176 108" fill="none" stroke="#d9cba6" strokeWidth="6" />
        <path d="M24 108 A76 76 0 0 1 60 46" fill="none" stroke="#d9694f" strokeWidth="6" opacity=".75" />
        <path d="M140 46 A76 76 0 0 1 176 108" fill="none" stroke="#5aa05a" strokeWidth="6" opacity=".75" />
        {ticks.map((t) => {
          const a = -90 + t * 1.8;
          return (
            <g key={t} transform={`rotate(${a} 100 108)`}>
              <line x1="100" y1="22" x2="100" y2={t % 50 === 0 ? 34 : 29} stroke="#3b2a1a" strokeWidth={t % 50 === 0 ? 2.2 : 1.2} />
            </g>
          );
        })}
        <text x="100" y="88" textAnchor="middle" className="gauge-num">{pct}%</text>
        <g className="needle" style={{ transform: `rotate(${angle}deg)`, transformOrigin: "100px 108px" }}>
          <line x1="100" y1="108" x2="100" y2="30" stroke="#b3261e" strokeWidth="2.6" strokeLinecap="round" />
          <line x1="100" y1="108" x2="100" y2="122" stroke="#b3261e" strokeWidth="4" strokeLinecap="round" />
        </g>
        <circle cx="100" cy="108" r="8" fill="#7a5a1c" stroke="#3b2a1a" />
        <circle cx="98" cy="106" r="3" fill="#f6e3a1" />
        <ellipse cx="100" cy="52" rx="96" ry="46" fill="url(#g-glass)" clipPath="url(#g-clip)" />
      </svg>
      <div className="plate">{label}</div>
    </div>
  );
}

// ---------- Password field with a show/hide key ----------

export function PasswordField({ value, onChange, autoComplete, minLength, label = "Password", required = true }) {
  const [shown, setShown] = useState(false);

  return (
    <label>
      {label}
      <span className="pw-wrap">
        <input
          type={shown ? "text" : "password"}
          value={value}
          onChange={onChange}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          spellCheck={false}
          autoCapitalize="none"
        />
        <button
          type="button"
          className="pw-toggle"
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          onClick={() => setShown(!shown)}
          title={shown ? "Hide password" : "Show password"}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
            <circle cx="12" cy="12" r="3" />
            {shown && <path d="M3 3l18 18" />}
          </svg>
        </button>
      </span>
    </label>
  );
}

// ---------- Copyable terminal snippet ----------
export function CodeBlock({ children, title }) {
  const [copied, setCopied] = useState(false);
  const text = String(children).trim();

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt("Copy this command:", text);
    }
  }

  return (
    <div className="code-block">
      {title && <div className="code-title">{title}</div>}
      <pre><code>{text}</code></pre>
      <button type="button" className="copy-key" onClick={copy} aria-label="Copy to clipboard">
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}
