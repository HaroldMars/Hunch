import { useEffect, useRef, useState } from 'react';
import Icon from '@shared/Icon.jsx';
import { api, toForm } from '../api.js';
import { useAdmin, PageHead, Spinner, Empty, Modal, Confirm, Avatar, fmtDate, useLoad } from '../ui.jsx';

const FOLDERS = [
  { key: 'inbox', label: 'Inbox', icon: 'inbox' },
  { key: 'sent', label: 'Sent', icon: 'send' },
  { key: 'drafts', label: 'Drafts', icon: 'draft' },
  { key: 'scheduled', label: 'Scheduled', icon: 'clock' },
  { key: 'trash', label: 'Trash', icon: 'trash' },
  { key: 'templates', label: 'Templates', icon: 'template' },
];

function RecipientInput({ value, onChange, placeholder }) {
  const [q, setQ] = useState('');
  const [sug, setSug] = useState([]);
  useEffect(() => {
    if (!q.trim()) { setSug([]); return undefined; }
    const t = setTimeout(() => api(`/admin/email/recipients?q=${encodeURIComponent(q)}`).then(setSug), 200);
    return () => clearTimeout(t);
  }, [q]);
  const add = (e) => {
    const v = e.trim().toLowerCase();
    if (v && !value.includes(v)) onChange([...value, v]);
    setQ(''); setSug([]);
  };
  return (
    <div className="chips-input">
      {value.map((e) => <span key={e} className="tag blue">{e}<button type="button" onClick={() => onChange(value.filter((x) => x !== e))} aria-label={`Remove ${e}`}>×</button></span>)}
      <input value={q} placeholder={value.length ? '' : placeholder} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (['Enter', ',', 'Tab'].includes(e.key) && q.trim()) { e.preventDefault(); add(q); } if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1)); }}
        onBlur={() => q.includes('@') && add(q)} />
      {sug.length > 0 && (
        <div className="suggest">{sug.map((u) => (
          <button type="button" key={u.id} onMouseDown={(e) => { e.preventDefault(); add(u.email); }}>
            <Avatar user={u} size={26} /><div><b className="small">{u.full_name}</b><div className="small muted">{u.email}</div></div>
          </button>
        ))}</div>
      )}
    </div>
  );
}

function Compose({ draft, onClose, onDone }) {
  const { toast } = useAdmin();
  const templates = useLoad(() => api('/admin/email/templates'), []);
  const [to, setTo] = useState(draft?.to_list || []);
  const [cc, setCc] = useState(draft?.cc_list || []);
  const [showCc, setShowCc] = useState(!!draft?.cc_list?.length);
  const [subject, setSubject] = useState(draft?.subject || '');
  const [body, setBody] = useState(draft?.body || '');
  const [kept, setKept] = useState(draft?.attachments || []);
  const [files, setFiles] = useState([]);
  const [schedule, setSchedule] = useState(draft?.scheduled_at ? toLocalInput(draft.scheduled_at) : '');
  const [templateId, setTemplateId] = useState(draft?.template_id || '');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();

  const applyTemplate = (id) => {
    setTemplateId(id);
    const t = templates.data?.find((x) => String(x.id) === String(id));
    if (t) { setSubject(t.subject); setBody(t.body); }
  };
  const submit = async (action) => {
    setBusy(true);
    try {
      await api('/admin/email', {
        method: 'POST',
        form: toForm({
          action, to: JSON.stringify(to), cc: JSON.stringify(cc), subject, body, template_id: templateId || undefined, draft_id: draft?.id,
          scheduled_at: action === 'schedule' ? new Date(schedule).toISOString() : undefined,
          keep_attachments: JSON.stringify(kept.map((k) => JSON.stringify(k))), attachments: files,
        }),
      });
      toast(action === 'send' ? 'Email sent' : action === 'draft' ? 'Draft saved' : `Scheduled for ${new Date(schedule).toLocaleString()}`, 'success');
      onDone(action === 'send' ? 'sent' : action === 'draft' ? 'drafts' : 'scheduled');
      onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title={draft?.id ? 'Edit draft' : 'New email'} wide onClose={onClose} footer={<>
      <button className="btn ghost" disabled={busy} onClick={() => submit('draft')}><Icon name="draft" size={15} /> Save draft</button>
      <div style={{ flex: 1 }} />
      <input className="input" type="datetime-local" value={schedule} min={toLocalInput(new Date().toISOString())} onChange={(e) => setSchedule(e.target.value)} style={{ width: 210 }} aria-label="Schedule time" />
      <button className="btn ghost" disabled={busy || !schedule} onClick={() => submit('schedule')}><Icon name="clock" size={15} /> Schedule</button>
      <button className="btn" disabled={busy} onClick={() => submit('send')}><Icon name="send" size={15} /> Send now</button>
    </>}>
      <label className="label">Template</label>
      <select className="select input" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
        <option value="">No template</option>
        {templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <label className="label" style={{ display: 'flex' }}>To <span style={{ flex: 1 }} />{!showCc && <button type="button" className="link-btn small" onClick={() => setShowCc(true)}>Add Cc</button>}</label>
      <RecipientInput value={to} onChange={setTo} placeholder="Type a name or email address" />
      {showCc && <><label className="label">Cc</label><RecipientInput value={cc} onChange={setCc} placeholder="Cc recipients" /></>}
      <label className="label">Subject</label>
      <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
      <label className="label">Message</label>
      <textarea className="input" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
      <div style={{ marginTop: 10 }}>
        {kept.map((a) => <span key={a.url} className="attach"><Icon name="clip" size={14} /> {a.name}<button className="link-btn" onClick={() => setKept(kept.filter((x) => x !== a))}>×</button></span>)}
        {files.map((f, i) => <span key={i} className="attach"><Icon name="clip" size={14} /> {f.name} <span className="muted">{Math.round(f.size / 1024)} KB</span><button className="link-btn" onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button></span>)}
        <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => fileRef.current.click()}><Icon name="clip" size={14} /> Attach files</button>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { setFiles([...files, ...e.target.files].slice(0, 10)); e.target.value = ''; }} />
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>Messages to Hunch users are delivered to their in-app inbox. External addresses are recorded but not relayed (no SMTP server in the local build).</p>
    </Modal>
  );
}
function toLocalInput(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Templates() {
  const { toast, user } = useAdmin();
  const { data, loading, reload } = useLoad(() => api('/admin/email/templates'), []);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const save = async () => {
    try {
      if (edit.id) await api(`/admin/email/templates/${edit.id}`, { method: 'PUT', body: edit });
      else await api('/admin/email/templates', { method: 'POST', body: edit });
      toast('Template saved', 'success');
      setEdit(null); reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  const canEdit = (t) => t.created_by === user.id || ['developer', 'sysadmin'].includes(user.role);
  return (
    <div className="mail-view" style={{ gridColumn: 'span 2' }}>
      <div className="card-head"><h3>Email templates</h3><button className="btn sm" onClick={() => setEdit({ name: '', subject: '', body: '' })}><Icon name="plus" size={14} /> New template</button></div>
      {loading ? <Spinner /> : !data.length ? <Empty icon="template" title="No templates yet">Save reusable subjects and messages, e.g. weekly check-ins or onboarding.</Empty> : data.map((t) => (
        <div key={t.id} className="notif-row">
          <div className="ic" style={{ background: 'var(--primary)' }}><Icon name="template" size={18} /></div>
          <div style={{ flex: 1, minWidth: 0 }}><div className="t">{t.name}</div><div className="b">{t.subject}</div><div className="m">By {t.author || 'unknown'} · updated {fmtDate(t.updated_at)}</div></div>
          {canEdit(t) && <><button className="btn ghost sm" onClick={() => setEdit(t)}><Icon name="edit" size={14} /> Edit</button>
            <button className="icon-btn" onClick={() => setDel(t)} aria-label="Delete template"><Icon name="trash" size={17} /></button></>}
        </div>
      ))}
      {edit && (
        <Modal title={edit.id ? 'Edit template' : 'New template'} onClose={() => setEdit(null)} footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn" onClick={save}>Save template</button></>}>
          <label className="label">Name</label><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <label className="label">Subject</label><input className="input" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />
          <label className="label">Body</label><textarea className="input" rows={9} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
        </Modal>
      )}
      {del && <Confirm title="Delete template?" message={`"${del.name}" will be removed.`} danger confirmLabel="Delete" onClose={() => setDel(null)} onConfirm={async () => { await api(`/admin/email/templates/${del.id}`, { method: 'DELETE' }); reload(); }} />}
    </div>
  );
}

export default function Email() {
  const { toast, refreshCounts, onNotification } = useAdmin();
  const [folder, setFolder] = useState('inbox');
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(null);
  const [compose, setCompose] = useState(null);
  const [counts, setCounts] = useState({});
  const load = () => {
    if (folder === 'templates') return;
    api(`/admin/email?folder=${folder}&q=${encodeURIComponent(q)}`).then(setList);
    api('/admin/email/counts').then(setCounts);
  };
  useEffect(() => { setList(null); setSel(null); load(); }, [folder]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => onNotification((n) => n.type === 'email' && load()), [folder, q]);
  // Scheduled mail moves to Sent when the server delivers it.
  useEffect(() => { if (folder !== 'scheduled') return undefined; const t = setInterval(load, 15e3); return () => clearInterval(t); }, [folder]);

  const open = async (m) => {
    if (m.folder === 'drafts') return setCompose(m);
    setSel(await api(`/admin/email/${m.id}`));
    if (!m.is_read) { setList((l) => l.map((x) => (x.id === m.id ? { ...x, is_read: 1 } : x))); refreshCounts(); api('/admin/email/counts').then(setCounts); }
  };
  const remove = async (m) => {
    await api(`/admin/email/${m.id}`, { method: 'DELETE' });
    toast(m.folder === 'trash' ? 'Deleted permanently' : 'Moved to trash');
    setSel(null); load();
  };
  const reply = (m, all) => setCompose({
    to_list: [m.from_email, ...(all ? m.to_list : [])].filter((e, i, a) => a.indexOf(e) === i),
    cc_list: all ? m.cc_list : [], subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`,
    body: `\n\n---- On ${fmtDate(m.sent_at)}, ${m.from_name || m.from_email} wrote:\n${m.body}`,
  });
  const forward = (m) => setCompose({ to_list: [], subject: `Fwd: ${m.subject}`, body: `\n\n---- Forwarded message ----\nFrom: ${m.from_email}\n\n${m.body}`, attachments: m.attachments });

  return (
    <>
      <PageHead title="Email" sub="Built-in email center for your organisation">
        <div className="chips-input" style={{ width: 280, padding: '4px 10px' }}><Icon name="search" size={16} /><input placeholder="Search emails" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search emails" /></div>
        <button className="btn" onClick={() => setCompose({})}><Icon name="edit" size={15} /> Compose</button>
      </PageHead>
      <div className="mail">
        <div className="mail-folders">
          {FOLDERS.map((f) => (
            <button key={f.key} className={`nav-item ${folder === f.key ? 'active' : ''}`} style={{ border: 0, background: folder === f.key ? undefined : 'none', textAlign: 'left' }} onClick={() => setFolder(f.key)}>
              <Icon name={f.icon} size={17} /> {f.label}
              {f.key === 'inbox' && counts.inbox > 0 && <span className="count" style={{ background: 'var(--primary)' }}>{counts.inbox}</span>}
              {f.key === 'drafts' && counts.drafts > 0 && <span className="count" style={{ background: 'var(--panel-3)', color: 'var(--text-2)' }}>{counts.drafts}</span>}
              {f.key === 'scheduled' && counts.scheduled > 0 && <span className="count" style={{ background: 'var(--panel-3)', color: 'var(--text-2)' }}>{counts.scheduled}</span>}
            </button>
          ))}
        </div>
        {folder === 'templates' ? <Templates /> : (
          <>
            <div className="mail-list">
              {!list ? <Spinner /> : !list.length ? <Empty icon={FOLDERS.find((f) => f.key === folder).icon} title={q ? 'No matches' : `${FOLDERS.find((f) => f.key === folder).label} is empty`} /> : list.map((m) => (
                <button key={m.id} className={`mail-item ${sel?.id === m.id ? 'active' : ''} ${!m.is_read && folder === 'inbox' ? 'unread' : ''}`} onClick={() => open(m)}>
                  <div className="top">
                    <b>{folder === 'inbox' ? (m.from_name || m.from_email) : m.to_list.join(', ') || '(no recipients)'}</b>
                    <span>{fmtDate(m.sent_at || m.scheduled_at || m.updated_at)}</span>
                  </div>
                  <div className="s">{m.subject || '(no subject)'}</div>
                  <div className="p">{m.attachments.length > 0 && '📎 '}{m.body.slice(0, 90) || '-'}</div>
                </button>
              ))}
            </div>
            <div className="mail-view">
              {!sel ? <Empty icon="mail" title="Select an email">Choose a message to read it.</Empty> : (
                <>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
                    {sel.folder === 'inbox' && <><button className="btn ghost sm" onClick={() => reply(sel)}><Icon name="reply" size={14} /> Reply</button><button className="btn ghost sm" onClick={() => reply(sel, true)}>Reply all</button></>}
                    <button className="btn ghost sm" onClick={() => forward(sel)}><Icon name="share" size={14} /> Forward</button>
                    {sel.folder === 'scheduled' && <button className="btn ghost sm" onClick={async () => { await api(`/admin/email/${sel.id}/cancel-schedule`, { method: 'POST' }); toast('Moved to drafts'); setSel(null); load(); }}>Cancel schedule</button>}
                    {sel.folder === 'inbox' && <button className="btn ghost sm" onClick={async () => { await api(`/admin/email/${sel.id}/read`, { method: 'POST', body: { read: false } }); setSel(null); load(); refreshCounts(); }}>Mark unread</button>}
                    <div style={{ flex: 1 }} />
                    <button className="btn ghost sm" onClick={() => remove(sel)}><Icon name="trash" size={14} /> {sel.folder === 'trash' ? 'Delete forever' : 'Delete'}</button>
                  </div>
                  <h2>{sel.subject || '(no subject)'}</h2>
                  <div className="small"><b>{sel.from_name || sel.from_email}</b> <span className="muted">&lt;{sel.from_email}&gt;</span></div>
                  <div className="small muted">To: {sel.to_list.join(', ')}{sel.cc_list.length ? ` · Cc: ${sel.cc_list.join(', ')}` : ''}</div>
                  <div className="small muted">{sel.folder === 'scheduled' ? `Scheduled for ${fmtDate(sel.scheduled_at)}` : fmtDate(sel.sent_at)}</div>
                  {sel.external?.length > 0 && <div className="tag amber" style={{ marginTop: 8 }}>Not relayed to external: {sel.external.join(', ')}</div>}
                  <div className="mail-body">{sel.body}</div>
                  {sel.attachments.length > 0 && <div style={{ marginTop: 18 }}>{sel.attachments.map((a) => <a key={a.url} className="attach" href={a.url} target="_blank" rel="noreferrer" download={a.name}><Icon name="clip" size={14} /> {a.name}</a>)}</div>}
                </>
              )}
            </div>
          </>
        )}
      </div>
      {compose && <Compose draft={compose} onClose={() => setCompose(null)} onDone={(f) => { setFolder(f); load(); }} />}
    </>
  );
}
