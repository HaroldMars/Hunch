import { get, all } from './db.js';

// A team is identified by its team leader's user id.
// TLs own their team; SMEs and agents belong to their team leader's team.
// Managers and developers oversee every team but belong to none.
export const OVERSEERS = ['developer', 'manager'];

export const teamOf = (u) => (!u ? null : u.role === 'tl' ? u.id : ['sme', 'agent'].includes(u.role) ? u.team_leader_id || null : null);
export const isOverseer = (u) => OVERSEERS.includes(u?.role);

export const teamLeader = (teamId) => get("SELECT id, full_name, avatar FROM users WHERE id = ? AND role = 'tl'", Number(teamId));
export const allTeams = () => all("SELECT id, full_name, avatar FROM users WHERE role = 'tl' AND status = 'active' ORDER BY full_name");

export const canAccessTeam = (u, teamId) => !!teamId && !!teamLeader(teamId) && (isOverseer(u) || teamOf(u) === Number(teamId));
export const canManageTeam = (u, teamId) => !!teamId && (isOverseer(u) || (u.role === 'tl' && u.id === Number(teamId)));

export const teamSettings = (teamId) => get('SELECT * FROM team_settings WHERE team_id = ?', teamId) || { team_id: teamId, members_can_post: 0 };

export const postPermission = (teamId, userId) => get('SELECT * FROM post_permissions WHERE team_id = ? AND user_id = ?', teamId, userId);

/** TL-only posting by default; SMEs post too. Members post only when the TL enables it and approved their request. */
export function canPostInTeam(u, teamId) {
  if (!canAccessTeam(u, teamId)) return false;
  if (canManageTeam(u, teamId) || u.role === 'sme') return true;
  return !!teamSettings(teamId).members_can_post && postPermission(teamId, u.id)?.status === 'approved';
}

export const teamMemberIds = (teamId) =>
  all("SELECT id FROM users WHERE status = 'active' AND (id = ? OR team_leader_id = ?)", teamId, teamId).map((r) => r.id);

/** Resolve the team a request is about: overseers pick with ?team=, everyone else gets their own. */
export function resolveTeam(u, requested) {
  if (isOverseer(u)) {
    const t = Number(requested) || allTeams()[0]?.id || null;
    return t && teamLeader(t) ? t : null;
  }
  return teamOf(u);
}
