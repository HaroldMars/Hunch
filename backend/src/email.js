import { get, run } from './db.js';
import { notify } from './notify.js';
import { nowIso } from './util.js';
import { sendComposed } from './mailer.js';

/**
 * Deliver a composed email through the built-in mail system.
 * Recipients that match a Hunch account receive a copy in their inbox.
 * Other addresses are sent for real over SMTP when it is configured (see mailer.js).
 */
export function deliverEmail(id) {
  const e = get('SELECT * FROM emails WHERE id = ?', id);
  if (!e) return;
  const to = JSON.parse(e.to_list);
  const cc = JSON.parse(e.cc_list);
  const external = [];
  const seen = new Set();
  const sender = get('SELECT full_name FROM users WHERE id = ?', e.from_id);
  for (const addr of [...to, ...cc]) {
    if (seen.has(addr)) continue;
    seen.add(addr);
    const u = get("SELECT id, role FROM users WHERE email = ? AND status = 'active'", addr);
    if (!u) {
      external.push(addr);
      continue;
    }
    const copy = Number(run(
      `INSERT INTO emails (owner_id, folder, from_id, from_email, to_list, cc_list, subject, body, attachments, sent_at)
       VALUES (?, 'inbox', ?, ?, ?, ?, ?, ?, ?, ?)`,
      u.id, e.from_id, e.from_email, e.to_list, e.cc_list, e.subject, e.body, e.attachments, nowIso()
    ).lastInsertRowid);
    // Staff get a dashboard notification; agents get it in the app.
    notify({
      userId: u.id, audience: u.role === 'agent' ? 'client' : 'admin', type: 'email', actorId: e.from_id,
      entityType: 'email', entityId: copy, title: `New email from ${sender?.full_name || e.from_email}`, body: e.subject,
    });
  }
  run("UPDATE emails SET folder = 'sent', sent_at = ?, scheduled_at = NULL, external = ?, is_read = 1 WHERE id = ?", nowIso(), JSON.stringify(external), id);
  if (external.length) {
    let attachments = [];
    try { attachments = JSON.parse(e.attachments || '[]'); } catch { /* none */ }
    sendComposed(external, sender?.full_name || e.from_email, e.subject, e.body, attachments).then((ok) => {
      if (!ok) notify({ userId: e.from_id, audience: 'admin', type: 'email', entityType: 'email', entityId: id, title: 'Email not delivered outside Hunch', body: `“${e.subject}” reached Hunch accounts, but couldn’t be sent to ${external.join(', ')}.` });
    });
  }
}
