import { Router } from 'express';
import { get, all, run, tx } from '../db.js';
import { auth, requireModule } from '../auth.js';
import { h, fail, deleteStoredFiles } from '../util.js';
import { notify } from '../notify.js';

// Teams (Admin Dashboard): a platform overview of the Work teams people create in the Hunch app.
// Teams are private, so staff see only what moderation needs (name, owner, size, dates). Never a team's
// feed, chats, schedules or members' activity. Staff can suspend (archive), restore or delete a team.

const r = Router();
r.use(auth({ app: 'admin' }), requireModule('teams'));

const teamOut = (t) => ({
  id: t.id, name: t.name, logo: t.logo, status: t.status, created_at: t.created_at, description: t.description,
  owner: t.owner_id ? get('SELECT id, user_code, full_name, email, avatar FROM users WHERE id = ?', t.owner_id) : null,
  members: get('SELECT COUNT(*) c FROM team_members WHERE team_id = ?', t.id).c,
  channels: get('SELECT COUNT(*) c FROM conversations WHERE team_id = ?', t.id).c,
});

r.get('/', h((req, res) => {
  const q = String(req.query.q || '').trim();
  const status = ['active', 'archived'].includes(req.query.status) ? req.query.status : '';
  const rows = all(
    `SELECT t.* FROM teams t LEFT JOIN users o ON o.id = t.owner_id
     WHERE (? = '' OR t.name LIKE ? OR o.full_name LIKE ? OR o.email LIKE ?) AND (? = '' OR t.status = ?)
     ORDER BY t.id DESC LIMIT 500`,
    q, `%${q}%`, `%${q}%`, `%${q}%`, status, status
  );
  const totals = get(`SELECT COUNT(*) teams, SUM(status = 'active') active,
    (SELECT COUNT(DISTINCT user_id) FROM team_members) people,
    (SELECT COUNT(*) FROM users WHERE work_mode = 1 AND status = 'active') work_mode FROM teams`);
  res.json({ teams: rows.map(teamOut), totals, canDelete: ['developer', 'sysadmin'].includes(req.user.role) });
}));

// Suspend (archive) or restore a team, e.g. after a report. Members are told.
r.patch('/:id', h((req, res) => {
  const t = get('SELECT * FROM teams WHERE id = ?', Number(req.params.id)) || fail(404, 'Team not found.');
  const status = req.body?.status;
  if (!['active', 'archived'].includes(status)) fail(400, 'Choose active or archived.');
  run('UPDATE teams SET status = ? WHERE id = ?', status, t.id);
  if (status !== t.status) {
    all('SELECT user_id FROM team_members WHERE team_id = ?', t.id).forEach((m) => notify({
      userId: m.user_id, type: 'team', title: t.name,
      body: status === 'archived' ? `${t.name} was suspended by Hunch moderators.` : `${t.name} was restored.`,
    }));
  }
  res.json(teamOut(get('SELECT * FROM teams WHERE id = ?', t.id)));
}));

r.delete('/:id', h((req, res) => {
  if (!['developer', 'sysadmin'].includes(req.user.role)) fail(403, 'Only developers and system administrators can delete teams.');
  const t = get('SELECT * FROM teams WHERE id = ?', Number(req.params.id)) || fail(404, 'Team not found.');
  const members = all('SELECT user_id FROM team_members WHERE team_id = ?', t.id).map((m) => m.user_id);
  tx(() => {
    run('DELETE FROM stories WHERE team_id = ?', t.id);
    run('DELETE FROM teams WHERE id = ?', t.id);
  });
  deleteStoredFiles(t.logo);
  members.forEach((uid) => notify({ userId: uid, type: 'team', title: t.name, body: `${t.name} was removed by Hunch moderators.` }));
  res.json({ ok: true });
}));

export default r;
