import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { ROLE_LABELS, moodByKey, themeCss } from '@shared/constants.js';
import { api, toForm } from '../api.js';
import { useApp } from '../store.jsx';
import { Avatar, TopBar, Spinner, Empty, Sheet, Confirm, useLoad } from '../components/ui.jsx';
import { PostCard, Composer } from '../components/Post.jsx';
import { StoryViewer, AddToHighlight } from '../components/Stories.jsx';
import { FriendButton } from './Connect.jsx';

function Highlights({ userId, mine, owner }) {
  const nav = useNavigate();
  const { data, reload } = useLoad(() => api(`/users/${userId}/highlights`), [userId]);
  const [open, setOpen] = useState(null);
  const [manage, setManage] = useState(null);
  // Deep link: /u/:id?highlight=:hid (from notifications and shared highlight cards).
  useEffect(() => {
    const want = Number(new URLSearchParams(window.location.search).get('highlight'));
    if (want && data) { const hl = data.find((x) => x.id === want); if (hl) setOpen(hl); window.history.replaceState(null, '', window.location.pathname); }
  }, [data]);
  if (!data) return <div style={{ height: 104 }} />;
  if (!data.length && !mine) return null;
  return (
    <>
      <div className="highlights" aria-label="Highlights">
        {mine && (
          <button className="highlight" onClick={() => nav('/archive?select=1')}>
            <div className="ring"><div><Icon name="plus" size={24} /></div></div><span>New</span>
          </button>
        )}
        {data.map((hl) => (
          <button key={hl.id} className="highlight" onClick={() => setOpen(hl)}>
            <div className="ring"><div style={{ background: hl.cover ? undefined : themeCss(hl.coverTheme) }}>{hl.cover ? <img src={hl.cover} alt="" /> : hl.cover_emoji || moodByKey(hl.coverMood)?.emoji || '✨'}</div></div>
            <span>{hl.title}</span>
          </button>
        ))}
      </div>
      {open && (
        <StoryViewer title={open.title} highlight={open} groups={[{ user: owner, stories: open.stories }]} onClose={() => { setOpen(null); reload(); }} onChanged={reload}
          onManage={mine ? () => { setManage(open); setOpen(null); } : undefined} />
      )}
      {manage && <ManageHighlight hl={manage} onClose={() => setManage(null)} onDone={reload} />}
    </>
  );
}

const COVER_EMOJIS = ['✨', '✈️', '🍜', '💼', '👯', '🌴', '🎉', '❤️', '📚', '🏋️', '🎵', '🌙', '☕', '🐶', '🌸', '🔥'];

function ManageHighlight({ hl: initial, onClose, onDone }) {
  const { toast } = useApp();
  const [hl, setHl] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [remove, setRemove] = useState([]);
  const [confirm, setConfirm] = useState(false);
  const [tab, setTab] = useState('cover');
  const fileRef = useRef();
  const apply = (r) => { setHl((h) => ({ ...h, ...r })); onDone(); };
  const cover = async (body) => { try { apply(await api(`/highlights/${hl.id}`, { method: 'PATCH', body })); } catch (e) { toast(e.message, 'error'); } };
  const upload = async (f) => { try { apply(await api(`/highlights/${hl.id}/cover`, { method: 'POST', form: toForm({ cover: f }) })); toast('Cover updated'); } catch (e) { toast(e.message, 'error'); } };
  const save = async () => {
    const r = await api(`/highlights/${hl.id}`, { method: 'PATCH', body: { title, removeStoryIds: remove } });
    toast(r.deleted ? 'Highlight removed (it was empty)' : 'Highlight updated', 'success');
    onDone(); onClose();
  };
  const photos = hl.stories.filter((s) => s.image);
  return (
    <Sheet title="Edit highlight" onClose={onClose}
      footer={<div style={{ display: 'flex', gap: 8 }}>
        <button className="btn ghost" style={{ flex: 1, color: 'var(--danger)' }} onClick={() => setConfirm(true)}><Icon name="trash" size={18} /> Delete</button>
        <button className="btn" style={{ flex: 1 }} onClick={save}>Save</button>
      </div>}>
      <div className="hl-edit-head">
        <div className="highlight"><div className="ring big"><div style={{ background: hl.cover ? undefined : themeCss(hl.coverTheme) }}>{hl.cover ? <img src={hl.cover} alt="" /> : hl.cover_emoji || moodByKey(hl.coverMood)?.emoji || '✨'}</div></div></div>
        <div style={{ flex: 1 }}>
          <label className="label" style={{ marginTop: 0 }}>Title</label>
          <input className="input" value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} />
          <div className="small muted" style={{ marginTop: 6 }}>{hl.stories.length - remove.length}/50 stories</div>
        </div>
      </div>
      <div className="seg" style={{ margin: '14px 0 10px' }}>
        <button className={tab === 'cover' ? 'active' : ''} onClick={() => setTab('cover')}><Icon name="image" size={16} /> Cover</button>
        <button className={tab === 'stories' ? 'active' : ''} onClick={() => setTab('stories')}><Icon name="sparkle" size={16} /> Stories</button>
      </div>
      {tab === 'cover' ? (
        <>
          <div className="section-title" style={{ marginTop: 4 }}>Emoji</div>
          <div className="emoji-grid">
            {COVER_EMOJIS.map((e) => <button key={e} className={hl.cover_emoji === e && !hl.cover_image ? 'on' : ''} onClick={() => cover({ cover_emoji: e })}>{e}</button>)}
          </div>
          <div className="section-title">Photo</div>
          <div className="cover-grid">
            <button className="cover-up" onClick={() => fileRef.current.click()}><Icon name="camera" size={20} /><span>Upload</span></button>
            {photos.map((s) => <button key={s.id} className={hl.cover_image === s.image ? 'on' : ''} onClick={() => cover({ cover_story_id: s.id })}><img src={s.image} alt="" /></button>)}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { e.target.files[0] && upload(e.target.files[0]); e.target.value = ''; }} />
          {(hl.cover_image || hl.cover_emoji) && <button className="link-btn small" style={{ marginTop: 10 }} onClick={() => cover({ clear_cover: true })}>Use the first story as cover</button>}
        </>
      ) : (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>Tap to remove stories. Add more from your story archive (up to 50).</p>
          <div className="archive-grid">
            {hl.stories.map((s) => (
              <button key={s.id} className={`archive-tile ${remove.includes(s.id) ? '' : 'sel'}`} style={{ background: themeCss(s.theme), opacity: remove.includes(s.id) ? 0.4 : 1 }}
                onClick={() => setRemove(remove.includes(s.id) ? remove.filter((x) => x !== s.id) : [...remove, s.id])}>
                {s.image ? <img src={s.image} alt="" /> : <span className="t">{moodByKey(s.mood)?.emoji} {s.text}</span>}
                <span className="check"><Icon name="check" size={12} /></span>
              </button>
            ))}
          </div>
        </>
      )}
      {confirm && <Confirm title="Delete highlight?" message="The stories stay in your archive." danger confirmLabel="Delete" onClose={() => setConfirm(false)}
        onConfirm={async () => { await api(`/highlights/${hl.id}`, { method: 'DELETE' }); onDone(); onClose(); }} />}
    </Sheet>
  );
}

export default function Profile() {
  const { id } = useParams();
  const uid = Number(id);
  const { user, toast } = useApp();
  const nav = useNavigate();
  const mine = uid === user.id;
  const profile = useLoad(() => api(`/users/${uid}`), [uid, user.avatar]);
  const [tab, setTab] = useState('posts');
  const posts = useLoad(() => (tab === 'posts' || tab === 'reposts' ? api(`/users/${uid}/posts?type=${tab}`) : tab === 'saved' ? api('/users/me/saved') : Promise.resolve([])), [uid, tab]);
  const [composing, setComposing] = useState(false);
  const [menu, setMenu] = useState(null);
  const p = profile.data;
  if (profile.loading && !p) return <div className="page"><Spinner /></div>;
  if (profile.error) return <div className="page"><TopBar title="Profile" back /><Empty icon="user" title="User not found">{profile.error.message}</Empty></div>;
  return (
    <div className="page flush">
      <TopBar title={mine ? 'My profile' : p.full_name} back={!mine}>
        {mine && <button className="icon-btn" onClick={() => nav('/archive')} aria-label="Story archive"><Icon name="clock" /></button>}
        {mine && <button className="icon-btn" onClick={() => nav('/settings')} aria-label="Settings"><Icon name="settings" /></button>}
        {!mine && <button className="icon-btn" onClick={() => setMenu('menu')} aria-label="More options"><Icon name="more" /></button>}
      </TopBar>
      <div className="profile-cover" style={p.cover ? { backgroundImage: `url(${p.cover})` } : undefined} />
      <div className="profile-head">
        <Avatar user={p} size={96} />
        <h2>{p.full_name}</h2>
        <div className="uid">{p.username ? `@${p.username} · ` : ''}{p.user_code} · {ROLE_LABELS[p.role]}</div>
        <WorkIdentity p={p} />
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {p.location && <span className="chip"><Icon name="globe" size={13} /> {p.location}</span>}
          <span className="chip"><Icon name={p.privacy === 'public' ? 'globe' : 'lock'} size={13} /> {p.privacy === 'public' ? 'Public' : 'Friends only'}</span>
        </div>
        {p.bio && <p className="bio">{p.bio}</p>}
        <div className="profile-stats">
          <div><b>{p.counts.posts}</b><span>Posts</span></div>
          <div><b>{p.counts.reposts}</b><span>Reposts</span></div>
          <div><b>{p.counts.friends}</b><span>Friends</span></div>
          {!mine && <div><b>{p.mutuals}</b><span>Mutual</span></div>}
        </div>
        <div className="profile-actions">
          {mine ? (
            <>
              <button className="btn ghost" onClick={() => nav('/edit-profile')}><Icon name="edit" size={17} /> Edit profile</button>
              <button className="btn" onClick={() => setComposing(true)}><Icon name="plus" size={17} /> New post</button>
            </>
          ) : <FriendButton user={p} relation={p.relation} onChange={() => { profile.reload(); posts.reload(); }} />}
        </div>
      </div>
      {p.canView ? (
        <>
          {/* Highlights sit between the profile actions and the content tabs. */}
          <Highlights userId={uid} mine={mine} owner={p} />
          <div className="profile-tabs" role="tablist">
            {[['posts', 'grid', 'Posts'], ['reposts', 'repost', 'Reposts'], ...(mine ? [['saved', 'bookmark', 'Saved']] : []), ['about', 'user', 'About']].map(([k, i, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}><Icon name={i} size={19} /><span>{l}</span></button>
            ))}
          </div>
          {(tab === 'posts' || tab === 'reposts' || tab === 'saved') && (posts.loading ? <Spinner /> : !posts.data.length ? (
            <Empty icon={{ posts: 'image', reposts: 'repost', saved: 'bookmark' }[tab]} title={{ posts: 'No posts yet', reposts: 'No reposts yet', saved: 'Nothing saved yet' }[tab]}>
              {tab === 'posts' ? (mine ? 'Share your first post.' : 'Nothing shared yet.') : tab === 'saved' ? 'Tap ⋯ on any post and choose Save post. Only you can see this list.' : 'Posts reposted from others show up here with their original author.'}
            </Empty>
          ) : posts.data.map((x) => <PostCard key={x.id} post={x} onDeleted={(pid) => { posts.setData(posts.data.filter((y) => y.id !== pid)); profile.reload(); }} />))}
          {tab === 'about' && <About p={p} mine={mine} />}
        </>
      ) : (
        <Empty icon="lock" title={p.relation === 'blocked' ? 'You blocked this person' : 'This profile is private'}>
          {p.relation === 'blocked' ? 'Unblock them to see their profile again.' : `Only ${p.full_name.split(' ')[0]}'s friends can see their posts and highlights.`}
        </Empty>
      )}
      {menu === 'menu' && (
        <Sheet title="" onClose={() => setMenu(null)}>
          <div className="menu-list">
            <button onClick={() => { navigator.clipboard?.writeText(p.user_code); toast(`Copied ${p.user_code}`); setMenu(null); }}><Icon name="link" /> Copy user ID</button>
            <button onClick={() => setMenu('report')}><Icon name="shield" /> Report {p.full_name.split(' ')[0]}</button>
            {p.relation === 'blocked'
              ? <button onClick={async () => { await api(`/users/${p.id}/block`, { method: 'DELETE' }); toast('Unblocked'); setMenu(null); profile.reload(); posts.reload(); }}><Icon name="userCheck" /> Unblock</button>
              : <button className="danger" onClick={() => setMenu('block')}><Icon name="userMinus" /> Block</button>}
          </div>
        </Sheet>
      )}
      {menu === 'block' && (
        <Confirm title={`Block ${p.full_name}?`} danger confirmLabel="Block" onClose={() => setMenu(null)}
          message="They won't be able to see your profile, posts or stories, message you, or send you friend requests. You'll also be removed as friends. They won't be notified."
          onConfirm={async () => { await api(`/users/${p.id}/block`, { method: 'POST' }); toast('Blocked'); profile.reload(); posts.reload(); }} />
      )}
      {menu === 'report' && <ReportSheet target="user" id={p.id} name={p.full_name} onClose={() => setMenu(null)} />}
      {composing && <Composer onClose={() => setComposing(false)} onPosted={(x) => { posts.setData([x, ...(posts.data || [])]); profile.reload(); }} />}
    </div>
  );
}

/** Job title, team and department, shown under the name (a professional identity on a social profile). */
export const departmentLabel = (d) => (!d ? '' : /department$/i.test(d) ? d : `${d} Department`);
function WorkIdentity({ p }) {
  const team = p.team_name || (p.managed_teams?.length ? `Manages ${p.managed_teams.length} team${p.managed_teams.length > 1 ? 's' : ''}` : '');
  if (!p.job_title && !team && !p.department) return null;
  return (
    <div className="work-id">
      {p.job_title && <span className="jt">{p.job_title}</span>}
      {team && <span className="tm">{p.team_color && <i style={{ background: p.team_color }} />}{team}</span>}
      {p.department && <span className="dp">{departmentLabel(p.department)}</span>}
    </div>
  );
}

function About({ p, mine }) {
  const friends = useLoad(() => api(`/users/${p.id}/friends`), [p.id]);
  const rows = [
    ['star', 'Job title', p.job_title], ['globe', 'Location', p.location], ['shield', 'Role', ROLE_LABELS[p.role]],
    ['users', 'Team', p.team_name], ['layers', 'Supervises', p.managed_teams?.map((t) => t.name).join(', ')],
    ['briefcase', 'Department', departmentLabel(p.department)], ['userCheck', 'Team leader', p.team_leader?.full_name],
    ['user', 'Username', p.username ? `@${p.username}` : null], ['link', 'User ID', p.user_code],
    ['calendar', 'Joined', new Date(p.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })],
    [p.privacy === 'public' ? 'globe' : 'lock', 'Profile', p.privacy === 'public' ? 'Public' : 'Friends only'],
  ].filter((r) => r[2]);
  return (
    <div style={{ padding: '0 16px 16px' }}>
      {p.bio && <div className="settings-group"><div className="sg-title">Bio</div><p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{p.bio}</p></div>}
      <div className="settings-group">
        <div className="sg-title">Details</div>
        {rows.map(([i, k, v]) => <div key={k} className="about-row"><Icon name={i} size={18} /><span>{k}</span><b>{v}</b></div>)}
      </div>
      <div className="settings-group">
        <div className="sg-title">Friends · {friends.data?.length ?? '…'}{!mine && p.mutuals ? ` · ${p.mutuals} mutual` : ''}</div>
        <div className="friend-strip">{(friends.data || []).slice(0, 12).map((f) => <a key={f.id} href={`/u/${f.id}`}><Avatar user={f} size={44} /><span>{f.full_name.split(' ')[0]}</span></a>)}</div>
      </div>
    </div>
  );
}

export function ReportSheet({ target, id, name, onClose }) {
  const { toast } = useApp();
  const [reason, setReason] = useState('');
  const presets = ['Harassment or bullying', 'Inappropriate content', 'Spam', 'Impersonation', 'Something else'];
  const send = async () => {
    try { await api('/reports', { method: 'POST', body: { target_type: target, target_id: id, reason } }); toast('Thanks. An administrator will review this.', 'success'); onClose(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Sheet title={`Report ${name}`} onClose={onClose} footer={<button className="btn block" disabled={!reason.trim()} onClick={send}>Submit report</button>}>
      <p className="small muted" style={{ marginTop: 0 }}>Reports are private and go to your administrators.</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {presets.map((x) => <button key={x} className={`btn sm ${reason === x ? '' : 'ghost'}`} style={{ borderRadius: 20 }} onClick={() => setReason(x)}>{x}</button>)}
      </div>
      <textarea className="input" placeholder="Add details (optional)" value={presets.includes(reason) ? '' : reason} onChange={(e) => setReason(e.target.value)} />
    </Sheet>
  );
}

export function EditProfile() {
  const { user, setSession, session, toast } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ full_name: user.full_name, username: user.username || '', bio: user.bio || '', job_title: user.job_title || '', department: user.department || '', location: user.location || '', privacy: user.privacy });
  const [busy, setBusy] = useState(false);
  const ref = useRef();
  const coverRef = useRef();
  const me = useLoad(() => api(`/users/${user.id}`), [user.id]); // team & department come from Team Management
  const work = me.data || {};
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const apply = (u) => setSession({ ...session, user: u });
  const save = async () => {
    setBusy(true);
    try {
      apply(await api('/users/me', { method: 'PATCH', body: f }));
      toast('Profile updated', 'success');
      nav(-1);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const upload = async (file) => {
    try { apply(await api('/users/me/avatar', { method: 'POST', form: toForm({ avatar: file }) })); toast('Profile picture updated', 'success'); } catch (e) { toast(e.message, 'error'); }
  };
  const uploadCover = async (file) => {
    try { apply(await api('/users/me/cover', { method: 'POST', form: toForm({ cover: file }) })); toast('Cover photo updated', 'success'); } catch (e) { toast(e.message, 'error'); }
  };
  const teamLabel = work.team_name || (work.managed_teams?.length ? work.managed_teams.map((t) => t.name).join(', ') : '');
  return (
    <div className="page">
      <TopBar title="Edit profile" back><button className="btn sm" disabled={busy} onClick={save}>Save</button></TopBar>
      <div className="ep-section">Account information</div>
      <label className="label">Cover photo</label>
      <div className="ep-cover" style={user.cover ? { backgroundImage: `url(${user.cover})` } : undefined}>
        <div className="ep-cover-actions">
          <button className="btn ghost sm" onClick={() => coverRef.current.click()}><Icon name="camera" size={16} /> {user.cover ? 'Change' : 'Add cover'}</button>
          {user.cover && <button className="btn ghost sm" onClick={async () => apply(await api('/users/me/cover', { method: 'DELETE' }))}>Remove</button>}
        </div>
      </div>
      <input ref={coverRef} type="file" accept="image/*" hidden onChange={(e) => { e.target.files[0] && uploadCover(e.target.files[0]); e.target.value = ''; }} />
      <label className="label">Profile picture</label>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <Avatar user={user} size={96} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost sm" onClick={() => ref.current.click()}><Icon name="camera" size={16} /> Change photo</button>
          {user.avatar && <button className="btn ghost sm" onClick={async () => apply(await api('/users/me/avatar', { method: 'DELETE' }))}>Remove</button>}
        </div>
        <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => { e.target.files[0] && upload(e.target.files[0]); e.target.value = ''; }} />
      </div>
      <label className="label">Full name</label>
      <input className="input" value={f.full_name} onChange={set('full_name')} maxLength={80} />
      <label className="label">Username</label>
      <input className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.replace(/[^a-zA-Z0-9._]/g, '') })} maxLength={30} placeholder="yourname" autoCapitalize="none" autoCorrect="off" />
      <label className="label">Bio</label>
      <textarea className="input" value={f.bio} onChange={set('bio')} maxLength={300} placeholder="Tell people a little about yourself" />
      <div className="ep-section">Work information</div>
      <label className="label">Job title</label>
      <input className="input" value={f.job_title} onChange={set('job_title')} maxLength={80} placeholder="e.g. Customer Service Representative" />
      <label className="label">{work.managed_teams?.length ? 'Teams you supervise' : 'Team'}</label>
      <div className="input readonly"><Icon name="users" size={16} /> {me.loading ? '…' : teamLabel || 'Not assigned to a team'}</div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>Your manager assigns teams in Team Management.</p>
      <label className="label">Department</label>
      <input className="input" value={f.department} onChange={set('department')} maxLength={80} placeholder={work.team_department || 'e.g. Social Media'} />
      <div className="ep-section">More</div>
      <label className="label">Location</label>
      <input className="input" value={f.location} onChange={set('location')} maxLength={80} />
      <label className="label">Who can see your profile, posts and highlights?</label>
      <div className="seg">
        <button className={f.privacy === 'public' ? 'active' : ''} onClick={() => setF({ ...f, privacy: 'public' })}><Icon name="globe" size={16} /> Public</button>
        <button className={f.privacy === 'friends' ? 'active' : ''} onClick={() => setF({ ...f, privacy: 'friends' })}><Icon name="lock" size={16} /> Friends only</button>
      </div>
      <p className="small muted">{f.privacy === 'public' ? 'Everyone on Hunch can view your profile and posts.' : 'Only your accepted friends can view your profile and posts.'}</p>
      <div className="small muted" style={{ marginTop: 20 }}>Email: {user.email} · User ID: {user.user_code}</div>
    </div>
  );
}

/** Highlight history: every story you've posted, including expired ones. Select to build a highlight. */
export function StoryArchive() {
  const { user } = useApp();
  const selectMode = new URLSearchParams(location.search).get('select') === '1';
  const { data, loading, reload } = useLoad(() => api('/stories/archive'), []);
  const [selecting, setSelecting] = useState(selectMode);
  const [picked, setPicked] = useState([]);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState(null);
  const nav = useNavigate();
  return (
    <div className="page">
      <TopBar title="Story archive" back>
        <button className="btn ghost sm" onClick={() => { setSelecting(!selecting); setPicked([]); }}>{selecting ? 'Cancel' : 'Select'}</button>
      </TopBar>
      <p className="small muted" style={{ marginTop: 0 }}>Your Mood Stories stay here after they disappear. {selecting ? 'Choose stories to save as a highlight.' : 'Tap to view.'}</p>
      {loading ? <Spinner /> : !data.length ? <Empty icon="clock" title="No stories yet">Share a Mood Story from your timeline.</Empty> : (
        <div className="archive-grid">
          {data.map((s, i) => (
            <button key={s.id} className={`archive-tile ${picked.includes(s.id) ? 'sel' : ''}`} style={{ background: themeCss(s.theme) }}
              onClick={() => (selecting ? setPicked(picked.includes(s.id) ? picked.filter((x) => x !== s.id) : [...picked, s.id]) : setView(i))}>
              {s.image ? <img src={s.image} alt="" /> : <span className="t">{moodByKey(s.mood)?.emoji}<br />{s.text}</span>}
              <span className="d">{new Date(s.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              {selecting && <span className="check"><Icon name="check" size={12} /></span>}
            </button>
          ))}
        </div>
      )}
      {selecting && picked.length > 0 && (
        <button className="btn" style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', zIndex: 30 }} onClick={() => setAdding(true)}>
          <Icon name="star" size={17} /> Add {picked.length} to highlight
        </button>
      )}
      {adding && <AddToHighlight storyIds={picked} onClose={() => setAdding(false)} onDone={() => { setPicked([]); setSelecting(false); nav(`/u/${user.id}`); }} />}
      {view !== null && <StoryViewer groups={[{ user, stories: [data[view]] }]} onClose={() => setView(null)} onChanged={reload} />}
    </div>
  );
}
