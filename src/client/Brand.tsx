/** Shared SVG asset for the app, login transition, favicon, and project docs. */
export function LogoMark({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/brand/ciphermemo-mark.svg"
      width={size}
      height={size}
      className={`logo-mark ${className}`}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

export default function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <LogoMark />
      </span>
      <span>CipherMemo</span>
    </div>
  );
}
