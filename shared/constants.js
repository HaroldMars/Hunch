// Shared between server, client and admin. Plain ESM, no dependencies.
export const MOODS = [
  { key: 'happy', label: 'Happy', emoji: '😊', color: '#FFC83D' },
  { key: 'sad', label: 'Sad', emoji: '😢', color: '#5B8DEF' },
  { key: 'angry', label: 'Angry', emoji: '😠', color: '#F2545B' },
  { key: 'tired', label: 'Tired', emoji: '😩', color: '#9CA3AF' },
  { key: 'excited', label: 'Excited', emoji: '🤩', color: '#FF8A3D' },
  { key: 'curious', label: 'Curious', emoji: '🧐', color: '#2EC4B6' },
  { key: 'lazy', label: 'Lazy', emoji: '🦥', color: '#B39B7D' },
  { key: 'sleepy', label: 'Sleepy', emoji: '😴', color: '#7C8DB5' },
  { key: 'energetic', label: 'Energetic', emoji: '⚡', color: '#3DDC84' },
  { key: 'chill', label: 'Chill', emoji: '😎', color: '#A78BFA' },
];
export const MOOD_KEYS = MOODS.map((m) => m.key);
export const moodByKey = (k) => MOODS.find((m) => m.key === k);

export const THEMES = [
  { key: 'midnight', label: 'Midnight', css: 'linear-gradient(160deg,#141414,#3a3a3a)' },
  { key: 'ocean', label: 'Ocean', css: 'linear-gradient(160deg,#1d4ed8,#22d3ee)' },
  { key: 'sunset', label: 'Sunset', css: 'linear-gradient(160deg,#f97316,#db2777)' },
  { key: 'forest', label: 'Forest', css: 'linear-gradient(160deg,#065f46,#84cc16)' },
  { key: 'berry', label: 'Berry', css: 'linear-gradient(160deg,#7c3aed,#ec4899)' },
  { key: 'aurora', label: 'Aurora', css: 'linear-gradient(160deg,#0f766e,#6366f1,#a855f7)' },
  { key: 'peach', label: 'Peach', css: 'linear-gradient(160deg,#fda4af,#fde68a)' },
  { key: 'mono', label: 'Mono', css: 'linear-gradient(160deg,#e5e5e5,#a3a3a3)' },
];
export const themeCss = (k) => (THEMES.find((t) => t.key === k) || THEMES[0]).css;

export const ROLES = ['developer', 'manager', 'tl', 'sme', 'agent'];
export const ROLE_LABELS = {
  developer: 'Developer',
  manager: 'Manager',
  tl: 'Team Leader',
  sme: 'SME',
  agent: 'Agent',
};
export const NOTE_MAX_WORDS = 35;
export const wordCount = (s) => (s || '').trim().split(/\s+/).filter(Boolean).length;
