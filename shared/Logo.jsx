// Hunch brand mark, traced from the supplied logo artwork.
export default function Logo({ size = 48, color = 'currentColor', title = 'Hunch', ...rest }) {
  return (
    <svg viewBox="420 240 1090 1460" width={size * (1090 / 1460)} height={size} role="img" aria-label={title} {...rest}>
      <path d="M465 275H575A262 262 0 0 1 837 537V1656H755A290 290 0 0 1 465 1366Z" fill={color} />
      <path d="M837 859H925A160 160 0 0 1 1085 1019V1440" fill="none" stroke={color} strokeWidth="9" />
      <circle cx="1274" cy="1460" r="194" fill={color} />
    </svg>
  );
}
