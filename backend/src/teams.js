import { get, all } from './db.js';

// Work Mode teams. Anyone can create a team; a team belongs to its members:
//   owner  — edit or delete the team, assign admins, remove members
//   admin  — invite members, manage channels and team settings
//   member — take part: chat, view and (when allowed) post team content
// Teams are always private: nothing about them is shown on public profiles.
export const TEAM_ROLES = ['owner', 'admin', 'member'];

export const teamRow = (teamId) => (teamId ? get('SELECT * FROM teams WHERE id = ?', Number(teamId)) : undefined);
const activeTeam = (teamId) => get("SELECT * FROM teams WHERE id = ? AND status = 'active'", Number(teamId));
export const teamName = (teamId) => teamRow(teamId)?.name || null;

/** This user's role in the team ('owner' | 'admin' | 'member'), or null. */
export const memberRole = (u, teamId) => {
  const id = typeof u === 'object' ? u?.id : u;
  if (!id || !teamId) return null;
  return get(
    "SELECT m.role FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.team_id = ? AND m.user_id = ? AND t.status = 'active'",
    Number(teamId), id
  )?.role || null;
};

/** Active teams this user belongs to, with their role in each. */
export const workTeams = (u) => (!u ? [] : all(
  `SELECT t.*, m.role my_role FROM team_members m JOIN teams t ON t.id = m.team_id
   WHERE m.user_id = ? AND t.status = 'active' ORDER BY t.name COLLATE NOCASE`, typeof u === 'object' ? u.id : u
));

export const canAccessTeam = (u, teamId) => !!memberRole(u, teamId);
/** Owners and admins run the team day to day (posts, schedules, invites, channels, settings). */
export const canManageTeam = (u, teamId) => ['owner', 'admin'].includes(memberRole(u, teamId));
export const isTeamOwner = (u, teamId) => memberRole(u, teamId) === 'owner';
export const canInvite = (u, teamId) => {
  const role = memberRole(u, teamId);
  return role === 'owner' || role === 'admin' || (role === 'member' && !!activeTeam(teamId)?.members_can_invite);
};

export const teamSettings = (teamId) => get('SELECT * FROM team_settings WHERE team_id = ?', teamId) || { team_id: teamId, members_can_post: 0 };

/** Owners and admins always post in the Work feed; members post when the team setting allows it. */
export function canPostInTeam(u, teamId) {
  if (!canAccessTeam(u, teamId)) return false;
  return canManageTeam(u, teamId) || !!teamSettings(teamId).members_can_post;
}

export const teamMemberIds = (teamId) =>
  all("SELECT m.user_id id FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? AND u.status = 'active'", Number(teamId)).map((r) => r.id);

/** Everyone who shares at least one team with this user (including the user). */
export const teammateIds = (u) => {
  const id = typeof u === 'object' ? u?.id : u;
  return all(
    `SELECT DISTINCT o.user_id id FROM team_members me JOIN team_members o ON o.team_id = me.team_id
     JOIN teams t ON t.id = me.team_id WHERE me.user_id = ? AND t.status = 'active'`, id
  ).map((r) => r.id);
};

/** The team a request is about: the requested one if the user is in it, otherwise their first team. */
export function resolveTeam(u, requested) {
  const mine = workTeams(u);
  const want = Number(requested);
  if (want) return mine.some((t) => t.id === want) ? want : null;
  return mine[0]?.id || null;
}
