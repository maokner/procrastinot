export function OrbitArt() {
  return (
    <div aria-hidden="true" className="pn-orbit-art">
      <div className="pn-orbit-stage">
        <svg viewBox="0 0 800 800" className="pn-orbit-svg pn-orbit-shell">
          <circle cx="400" cy="400" r="300" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.18" />
          <circle cx="400" cy="400" r="228" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.14" />
          <circle cx="400" cy="400" r="156" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.16" />
          <path d="M400 74V726M74 400H726" stroke="currentColor" strokeWidth="1" opacity="0.16" />
        </svg>
        <svg viewBox="0 0 800 800" className="pn-orbit-svg pn-orbit-core">
          <circle
            cx="400"
            cy="400"
            r="260"
            fill="none"
            stroke="currentColor"
            strokeWidth="18"
            strokeDasharray="12 34"
            opacity="0.12"
          />
          <circle
            cx="400"
            cy="400"
            r="194"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeDasharray="3 12"
            opacity="0.18"
          />
          <rect x="372" y="372" width="56" height="56" fill="none" stroke="currentColor" strokeWidth="4" opacity="0.75" />
          <path d="M400 112L423 164L475 187L423 210L400 262L377 210L325 187L377 164Z" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.28" />
        </svg>
        <svg viewBox="0 0 800 800" className="pn-orbit-svg pn-orbit-markers">
          <g fill="currentColor" opacity="0.92">
            <rect x="395" y="78" width="10" height="40" />
            <rect x="395" y="682" width="10" height="40" />
            <rect x="78" y="395" width="40" height="10" />
            <rect x="682" y="395" width="40" height="10" />
          </g>
          <g fill="currentColor" opacity="0.65">
            <circle cx="400" cy="136" r="10" />
            <circle cx="664" cy="400" r="10" />
            <circle cx="400" cy="664" r="10" />
            <circle cx="136" cy="400" r="10" />
          </g>
        </svg>
      </div>
    </div>
  );
}
