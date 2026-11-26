// Hunch custom icon set — 24px grid, 1.8 stroke, rounded joins.
const P = {
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.8 3.9 5.8 3.9 9s-1.3 6.2-3.9 9c-2.6-2.8-3.9-5.8-3.9-9S9.4 5.8 12 3z" /></>,
  cards: <><rect x="4" y="6.5" width="10" height="14" rx="2" transform="rotate(-10 9 13.5)" /><rect x="10" y="4" width="10" height="14" rx="2" transform="rotate(8 15 11)" /></>,
  chat: <path d="M12 4c4.8 0 8.5 3 8.5 6.9 0 3.9-3.7 6.9-8.5 6.9-1 0-1.9-.1-2.8-.4L5 19.5l1.1-3.6C4.5 14.6 3.5 12.9 3.5 10.9 3.5 7 7.2 4 12 4z" />,
  user: <><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4" /></>,
  users: <><circle cx="9" cy="8.5" r="3.4" /><path d="M2.8 19.5c1-3.2 3.4-4.8 6.2-4.8s5.2 1.6 6.2 4.8" /><path d="M15.5 5.3a3.4 3.4 0 0 1 0 6.4M17.5 14.9c1.8.6 3 2.1 3.7 4.6" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  bellOff: <><path d="M8.5 5.2A6 6 0 0 1 18 11v4.5M6 9.5v7l-1.5 1.5h13" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0M3.5 3.5l17 17" /></>,
  heart: <path d="M12 20s-7.5-4.4-7.5-10.1A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.6C19.5 15.6 12 20 12 20z" />,
  comment: <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-7l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z" />,
  repost: <><path d="M4.5 11V9a3 3 0 0 1 3-3h11l-3-3M19.5 13v2a3 3 0 0 1-3 3h-11l3 3" /></>,
  share: <path d="M13.5 5.5l7 6.5-7 6.5v-3.8c-4.6 0-7.6 1.3-10 4.3.8-5.2 3.8-9.2 10-10z" />,
  send: <><path d="M20.5 3.5l-17 7.2 6.8 2.6 2.6 6.8z" /><path d="M10.3 13.3l10.2-9.8" /></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="M20.5 16l-5-5-8.5 8.5" /></>,
  phone: <path d="M6.6 3.5h2.6l1.5 4-2 1.3a11 11 0 0 0 6.5 6.5l1.3-2 4 1.5v2.6A2.1 2.1 0 0 1 18.3 19.6 15.9 15.9 0 0 1 4.4 5.7 2.1 2.1 0 0 1 6.6 3.5z" />,
  video: <><rect x="3" y="6.5" width="12.5" height="11" rx="2" /><path d="M15.5 10.5 21 7.5v9l-5.5-3" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" /></>,
  micOff: <><path d="M15 9.5V6a3 3 0 0 0-5.6-1.5M9 9v2a3 3 0 0 0 4.6 2.5" /><path d="M5.5 11a6.5 6.5 0 0 0 10.7 5M18.4 12.5a6.4 6.4 0 0 0 .1-1.5M12 17.5V21M8.5 21h7M3.5 3.5l17 17" /></>,
  camera: <><path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.3" r="3.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  back: <path d="M15 5l-7 7 7 7" />,
  next: <path d="M9 5l7 7-7 7" />,
  down: <path d="M6 9l6 6 6-6" />,
  more: <><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></>,
  pin: <><path d="M9 3.5h6l-1 5 3.5 3.5h-11L10 8.5z" /><path d="M12 12v8.5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></>,
  logout: <><path d="M14 4.5H6.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H14" /><path d="M11 12h9.5M17 8.5l3.5 3.5-3.5 3.5" /></>,
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  checks: <><path d="M2.5 12.5L7 17l9.5-9.5" /><path d="M12 16l1 1 9.5-9.5" /></>,
  smile: <><circle cx="12" cy="12" r="9" /><path d="M8.3 14.2c.9 1.3 2.2 2 3.7 2s2.8-.7 3.7-2" /><circle cx="9" cy="9.8" r=".6" /><circle cx="15" cy="9.8" r=".6" /></>,
  trash: <><path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13" /><path d="M10 10.5v5.5M14 10.5v5.5" /></>,
  edit: <><path d="M4.5 19.5l1-4.5L15.8 4.7a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5L9 18.5z" /><path d="M13.5 7l3.5 3.5" /></>,
  mail: <><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3.5 7l8.5 6 8.5-6" /></>,
  chart: <><path d="M4 20V4M4 20h16" /><path d="M8 16v-4M12 16V8M16 16v-6" /></>,
  file: <><path d="M6.5 3.5h7l4 4v13h-11z" /><path d="M13.5 3.5v4h4M9 12h6M9 15.5h6" /></>,
  inbox: <><path d="M3.5 13.5l2.5-8h12l2.5 8v5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" /><path d="M3.5 13.5h5l1 2.5h5l1-2.5h5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  clip: <path d="M19 11.5l-7.2 7.2a4.5 4.5 0 0 1-6.4-6.4l7.6-7.6a3 3 0 0 1 4.3 4.3l-7.4 7.4a1.5 1.5 0 0 1-2.1-2.1l6.7-6.7" />,
  shield: <><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z" /><path d="M8.8 12l2.2 2.2 4.2-4.4" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  globeLock: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.8 3.9 5.8 3.9 9s-1.3 6.2-3.9 9" /></>,
  flame: <path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.6 2.9-5.5 3.9-9.3 2.3 1.5 3.4 3.3 3.6 5.2.9-.6 1.5-1.6 1.7-2.8 2.4 1.9 3.8 4.3 3.8 6.9 0 3.6-2.6 6.2-6.5 6.2z" />,
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" />,
  userPlus: <><circle cx="10" cy="8.5" r="3.8" /><path d="M2.5 20c1.2-3.6 4-5.4 7.5-5.4 1.4 0 2.7.3 3.8.9M18.5 13v6M15.5 16h6" /></>,
  userCheck: <><circle cx="10" cy="8.5" r="3.8" /><path d="M2.5 20c1.2-3.6 4-5.4 7.5-5.4 1.4 0 2.7.3 3.8.9M15.5 17l2 2 3.5-4" /></>,
  userMinus: <><circle cx="10" cy="8.5" r="3.8" /><path d="M2.5 20c1.2-3.6 4-5.4 7.5-5.4 1.4 0 2.7.3 3.8.9M15.5 17h6" /></>,
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>,
  report: <><rect x="4.5" y="3.5" width="15" height="17" rx="2" /><path d="M8.5 16v-3M12 16V9M15.5 16v-5" /></>,
  megaphone: <><path d="M4 10v4h3l8 4.5v-13L7 10z" /><path d="M18 9.5a3.5 3.5 0 0 1 0 5M7 14l1.5 5.5h2.5" /></>,
  key: <><circle cx="8" cy="15" r="3.8" /><path d="M10.8 12.3L19 4.5M16 7.5l2.5 2.5M14 9.5l2 2" /></>,
  rotate: <><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v3.8h3.8" /></>,
  crop: <><path d="M6.5 3v14.5H21" /><path d="M3 6.5h14.5V21" /></>,
  minus: <path d="M5 12h14" />,
  refresh: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v3.8h-3.8" /></>,
  draft: <><path d="M4.5 19.5l1-4.5L15.8 4.7a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5L9 18.5z" /></>,
  template: <><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="M3.5 9h17M9 9v11.5" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3.5 3.5l17 17M10.6 6.1A8.6 8.6 0 0 1 12 6c6 0 9.5 6 9.5 6a16.8 16.8 0 0 1-3.2 3.9M6.4 7.4C3.9 9.2 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  sparkle: <path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  note: <><path d="M5 4.5h14v10.5l-4.5 4.5H5z" /><path d="M14.5 19.5V15H19M8.5 9h7M8.5 12h4" /></>,
  filter: <path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" />,
  download: <><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  map: <><path d="M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2z" /><path d="M9 4.5v13M15 6.5v13" /></>,
  location: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></>,
  navigate: <path d="M20 4 4 11l7 2 2 7z" />,
  crosshair: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></>,
  route: <><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="6" r="2.2" /><path d="M8 18h7.5a3 3 0 0 0 0-6h-7a3 3 0 0 1 0-6H16" /></>,
  walk: <><circle cx="13" cy="4.5" r="1.8" /><path d="m10 21 2-6-2.5-2.5L11 8l3 1.5 2 3.5M9.5 12.5 7 11l2-3M12 15l3 6" /></>,
  bike: <><circle cx="5.5" cy="16.5" r="3" /><circle cx="18.5" cy="16.5" r="3" /><path d="M5.5 16.5 9 10h5l4.5 6.5M14 10l-1.5-3H10M9 10l3 6.5h-6.5" /></>,
  car: <><path d="M4 16.5v-4l2-5h12l2 5v4z" /><path d="M4 12.5h16" /><circle cx="7.5" cy="16.5" r="1.8" /><circle cx="16.5" cy="16.5" r="1.8" /></>,
  briefcase: <><rect x="3.5" y="7" width="17" height="12.5" rx="2" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12.5h17" /></>,
  bookmark: <path d="M6.5 4h11v16.5L12 16.5l-5.5 4z" />,
  home: <><path d="M4 10.5 12 4l8 6.5V20h-5.5v-5.5h-5V20H4z" /></>,
  layers: <><path d="m12 4 8.5 4.5L12 13 3.5 8.5z" /><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" /></>,
  sticker: <><path d="M20.5 12.5V7a3.5 3.5 0 0 0-3.5-3.5H7A3.5 3.5 0 0 0 3.5 7v10A3.5 3.5 0 0 0 7 20.5h5.5z" /><path d="M12.5 20.5v-4a4 4 0 0 1 4-4h4" /><circle cx="9" cy="10" r=".9" fill="currentColor" /><circle cx="14.5" cy="10" r=".9" fill="currentColor" /><path d="M8.5 14.2c.9.9 2 1.3 3.2 1.2" /></>,
  reply: <path d="M10 6L4 12l6 6M4.5 12H14a6 6 0 0 1 6 6" />,
};

export default function Icon({ name, size = 22, stroke = 1.8, fill = 'none', className, style, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, ...style }}
      aria-hidden="true"
      {...rest}
    >
      {P[name] || P.more}
    </svg>
  );
}
