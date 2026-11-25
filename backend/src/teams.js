import { get, all } from './db.js';
import { TEAM_ROLES } from '../../shared/constants.js';

// Work Mode teams. Anyone with Work Mode on can create one, and chooses their own role in it.
// Every member holds a work role, highest first:
//   manager — manage members, assign roles, create schedules, run the Work feed, see team analytics
//   tl      — manage members, create schedules, post announcements, run the team feed
//   sme     — create schedules, monitor team activity, support members
//   agent   — view the schedule and team feed, take part in team chat
// The team's owner (teams.owner_id) can also edit or delete the team and assign any role.
// Teams are always private: nothing about them is shown on public profiles.
export { TEAM_ROLES };
export const ROLE_RANK = { manager: 4, tl: 3, sme: 2, agent: 1 };

export const teamRow = (teamId) => (teamId ? get('SELECT * FROM teams WHERE id = ?', Number(teamId)) : undefined);
const activeTeam = (teamId) => get("SELECT * FROM teams WHERE id = ? AND status = 'active'", Number(teamId));
export const teamName = (teamId) => teamRow(teamId)?.name || null;
const idOf = (u) => (typeof u === 'object' ? u?.id : u);

/** This user's work role in the team ('manager' | 'tl' | 'sme' | 'agent'), or null when they're not on it. */
export const memberRole = (u, teamId) => {
  const id = idOf(u);
  if (!id || !teamId) return null;
  return get(
    "SELECT m.role FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.team_id = ? AND m.user_id = ? AND t.status = 'active'",
    Number(teamId), id
  )?.role || null;
};

/** Active teams this user belongs to, with their role in each. */
export const workTeams = (u) => (!u ? [] : all(
  `SELECT t.*, m.role my_role FROM team_members m JOIN teams t ON t.id = m.team_id
   WHERE m.user_id = ? AND t.status = 'active' ORDER BY t.name COLLATE NOCASE`, idOf(u)
));

export const canAccessTeam = (u, teamId) => !!memberRole(u, teamId);
export const isTeamOwner = (u, teamId) => !!memberRole(u, teamId) && teamRow(teamId)?.owner_id === idOf(u);
const roleIn = (u, teamId, roles) => {
  const role = memberRole(u, teamId);
  return !!role && (roles.includes(role) || teamRow(teamId)?.owner_id === idOf(u));
};
/** Managers and team leaders run the team day to day: members, invitations, channels and the feed. The owner always can. */
export const canManageTeam = (u, teamId) => roleIn(u, teamId, ['manager', 'tl']);
/** Assign roles and change team settings: managers and the owner. */
export const canAssignRoles = (u, teamId) => roleIn(u, teamId, ['manager']);
export const canEditSettings = canAssignRoles;
/** Team analytics (mood, activity): managers and the owner. */
export const canSeeAnalytics = canAssignRoles;
/** Create and edit schedules: managers, team leaders and SMEs. */
export const canSchedule = (u, teamId) => roleIn(u, teamId, ['manager', 'tl', 'sme']);
/** Member activity in the Members list: managers, team leaders and SMEs. */
export const canMonitor = canSchedule;
/** Announcements: managers and team leaders. */
export const canAnnounce = canManageTeam;
export const canInvite = (u, teamId) => canManageTeam(u, teamId) || (canAccessTeam(u, teamId) && !!activeTeam(teamId)?.members_can_invite);

export const teamSettings = (teamId) => get('SELECT * FROM team_settings WHERE team_id = ?', teamId) || { team_id: teamId, members_can_post: 0 };

/** Managers, team leaders and SMEs always post in the Work feed; agents post when the team setting allows it. */
export function canPostInTeam(u, teamId) {
  if (!canAccessTeam(u, teamId)) return false;
  return roleIn(u, teamId, ['manager', 'tl', 'sme']) || !!teamSettings(teamId).members_can_post;
}

export const teamMemberIds = (teamId) =>
  all("SELECT m.user_id id FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? AND u.status = 'active'", Number(teamId)).map((r) => r.id);

/** Everyone who shares at least one team with this user (including the user). */
export const teammateIds = (u) => all(
  `SELECT DISTINCT o.user_id id FROM team_members me JOIN team_members o ON o.team_id = me.team_id
   JOIN teams t ON t.id = me.team_id WHERE me.user_id = ? AND t.status = 'active'`, idOf(u)
).map((r) => r.id);

/** The team a request is about: the requested one if the user is in it, otherwise their first team. */
export function resolveTeam(u, requested) {
  const mine = workTeams(u);
  const want = Number(requested);
  if (want) return mine.some((t) => t.id === want) ? want : null;
  return mine[0]?.id || null;
}
