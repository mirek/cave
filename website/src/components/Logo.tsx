export const Logo = ({ compact = false }: { compact?: boolean }) => (
  <span className="logo" aria-label="CAVE">
    <svg viewBox="0 0 44 44" role="img" aria-hidden="true">
      <path d="M6 7h32v7H17v16h21v7H6z" />
      <path className="logo-cut" d="M17 18h17v8H17z" />
    </svg>
    {!compact && <span>CAVE</span>}
  </span>
)
