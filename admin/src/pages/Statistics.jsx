import { useEffect, useState } from 'react';
import Icon from '@shared/Icon.jsx';
import { MOODS } from '@shared/constants.js';
import { api } from '../api.js';
import { useAdmin, PageHead, Spinner, Avatar, daysAgo, localDay } from '../ui.jsx';
import { TotalsBars, Lines, MoodDistribution, SENTIMENT, withSentiment } from '../charts.jsx';

export function RangeFilters({ value, onChange, teams, showMood = true, children }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const preset = (n) => onChange({ ...value, from: daysAgo(n - 1), to: localDay() });
  return (
    <div className="filters">
      <div className="f"><span>Range</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {[7, 30, 90].map((n) => <button key={n} className={`btn sm ${value.from === daysAgo(n - 1) && value.to === localDay() ? '' : 'ghost'}`} onClick={() => preset(n)}>{n}d</button>)}
        </div>
      </div>
      <label className="f"><span>From</span><input className="input" type="date" value={value.from} max={value.to} onChange={set('from')} /></label>
      <label className="f"><span>To</span><input className="input" type="date" value={value.to} min={value.from} max={localDay()} onChange={set('to')} /></label>
      {teams?.length > 0 && (
        <label className="f"><span>Team leader</span>
          <select className="select" value={value.teamLeaderId || ''} onChange={set('teamLeaderId')}>
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </select>
        </label>
      )}
      {showMood && (
        <label className="f"><span>Mood</span>
          <select className="select" value={value.mood || ''} onChange={set('mood')}>
            <option value="">All moods</option>
            {MOODS.map((m) => <option key={m.key} value={m.key}>{m.emoji} {m.label}</option>)}
          </select>
        </label>
      )}
      {children}
    </div>
  );
}
export const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined)).toString();

function Tile({ icon, label, value, detail, tint = 'var(--primary)' }) {
  return (
    <div className="card stat">
      <div className="k"><span className="ic" style={{ background: `color-mix(in srgb, ${tint} 16%, transparent)`, color: tint }}><Icon name={icon} size={17} /></span>{label}</div>
      <div className="v">{value}</div>
      {detail && <div className="d">{detail}</div>}
    </div>
  );
}

const n = (v) => Number(v || 0).toLocaleString();
const pctOf = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '0%');

function Section({ title, hint, children, right }) {
  return (
    <div className="pf-section">
      <div className="pf-h"><div><h3>{title}</h3>{hint && <p className="hint">{hint}</p>}</div>{right}</div>
      {children}
    </div>
  );
}

function TopList({ title, hint, rows, empty, render }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      {hint && <p className="hint">{hint}</p>}
      {!rows?.length ? <p className="muted small">{empty}</p> : <ol className="pf-top">{rows.map((r, i) => <li key={r.id ?? r.name ?? i}><span className="rk">{i + 1}</span>{render(r)}</li>)}</ol>}
    </div>
  );
}

/** Platform-wide tracking: users, Work Mode, content, team roles and the most active people, teams and places. */
function PlatformOverview() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState(null);
  const load = () => api(`/admin/platform?days=${days}`).then(setD);
  useEffect(() => { load(); const t = setInterval(load, 30e3); return () => clearInterval(t); }, [days]);
  if (!d) return <Spinner />;
  const u = d.users, w = d.work, c = d.content;
  const roleIcon = { manager: 'star', tl: 'shield', sme: 'sparkle', agent: 'user' };
  return (
    <>
      <Section title="Users" hint={`Regular accounts; ${n(u.staff)} staff accounts not counted`}>
        <div className="grid g4">
          <Tile icon="users" label="Total registered users" value={n(u.registered)} detail={`${n(u.newMonth)} joined this month`} />
          <Tile icon="check" label="Active users" value={n(u.active)} detail={`Active in the last ${u.activeWindowDays} days`} tint="var(--success)" />
          <Tile icon="clock" label="Inactive users" value={n(u.inactive)} detail={`${pctOf(u.inactive, u.registered)} of registered`} tint="var(--warn)" />
          <Tile icon="globe" label="Online now" value={n(u.online)} detail="Connected to Hunch right now" tint="#1baf7a" />
        </div>
        <div className="grid g3" style={{ marginTop: 12 }}>
          <Tile icon="userPlus" label="New users today" value={n(u.newToday)} />
          <Tile icon="userPlus" label="New users this week" value={n(u.newWeek)} detail="Since Monday" />
          <Tile icon="userPlus" label="New users this month" value={n(u.newMonth)} detail="Since the 1st" />
        </div>
      </Section>

      <Section title="Work Mode">
        <div className="grid g4">
          <Tile icon="briefcase" label="Work Mode enabled" value={n(w.enabled)} detail={`${pctOf(w.enabled, w.enabled + w.disabled)} of active users`} tint="#8b5cf6" />
          <Tile icon="user" label="Work Mode disabled" value={n(w.disabled)} tint="var(--text-3)" />
          <Tile icon="layers" label="Total teams created" value={n(w.teams)} detail={`${n(w.activeTeams)} active · ${n(w.teams - w.activeTeams)} suspended`} />
          <Tile icon="plus" label="New teams today" value={n(w.newTeamsToday)} tint="var(--success)" />
        </div>
      </Section>

      <Section title="Content">
        <div className="grid g3">
          <Tile icon="image" label="Total posts" value={n(c.posts)} detail={`+ ${n(c.workPosts)} Work feed posts`} />
          <Tile icon="sparkle" label="Total stories" value={n(c.stories)} />
          <Tile icon="note" label="Total notes" value={n(c.notes)} />
          <Tile icon="chat" label="Total messages" value={n(c.messages)} />
          <Tile icon="userCheck" label="Friend connections" value={n(c.friendships)} />
          <Tile icon="layers" label="Active teams" value={n(w.activeTeams)} />
        </div>
      </Section>

      <Section title="Teams" hint="Roles across all active teams (a person on two teams counts twice)">
        <div className="grid g4">
          {d.teams.roles.map((r) => <Tile key={r.role} icon={roleIcon[r.role]} label={`Total ${r.label === 'SME' ? 'SMEs' : `${r.label}s`}`} value={n(r.count)} />)}
        </div>
        <div className="grid g3" style={{ marginTop: 12 }}>
          <Tile icon="users" label="Total team members" value={n(d.teams.members)} detail="People on at least one team" />
        </div>
      </Section>

      <Section title="Platform analytics" hint={`Most active in the last ${d.days} days`}
        right={<div style={{ display: 'flex', gap: 4 }}>{[7, 30, 90].map((x) => <button key={x} className={`btn sm ${days === x ? '' : 'ghost'}`} onClick={() => setDays(x)}>{x}d</button>)}</div>}>
        <div className="grid g3">
          <TopList title="Most active users" hint="Posts, stories, comments and messages" rows={d.top.users} empty="No activity yet."
            render={(r) => <><Avatar user={r} size={28} /><span className="nm"><b>{r.full_name}</b><small>{r.posts} posts · {r.stories} stories · {r.messages} messages</small></span></>} />
          <TopList title="Most active teams" hint="Work posts, channel messages and schedules" rows={d.top.teams} empty="No team activity yet."
            render={(r) => <><span className="pf-logo">{r.logo ? <img src={r.logo} alt="" /> : r.name[0]}</span><span className="nm"><b>{r.name}</b><small>{r.members} members · {r.messages} messages · {r.posts} posts</small></span></>} />
          <TopList title="Most active team chats" hint="Messages in team channels" rows={d.top.teamChats} empty="No team chat messages yet."
            render={(r) => <><span className="pf-logo">#</span><span className="nm"><b>#{r.name}</b><small>{r.team} · {r.messages} {r.messages === 1 ? "message" : "messages"}</small></span></>} />
        </div>
        <div className="grid g2" style={{ marginTop: 16 }}>
          <div className="card stat">
            <div className="k">Most used mood</div>
            {d.top.mood ? <><div className="v">{d.top.mood.emoji} {d.top.mood.label}</div><div className="d">{n(d.top.mood.count)} check-ins</div></> : <div className="v muted">-</div>}
          </div>
          <TopList title="Most tagged locations" hint="Places tagged on stories" rows={d.top.locations} empty="No tagged places yet."
            render={(r) => <><Icon name="location" size={16} /><span className="nm"><b>{r.name}</b><small>{r.count} {r.count === 1 ? 'story' : 'stories'}</small></span></>} />
        </div>
      </Section>
    </>
  );
}

export default function Statistics() {
  const { user, can, onNotification } = useAdmin();
  const [f, setF] = useState({ from: daysAgo(29), to: localDay(), mood: '', teamLeaderId: '' });
  const [data, setData] = useState(null);
  const [teams, setTeams] = useState(null);
  const [period, setPeriod] = useState('daily');
  const [asTable, setAsTable] = useState(false);
  const [updated, setUpdated] = useState(null);
  const [tab, setTab] = useState('platform');
  const scoped = ['tl', 'sme'].includes(user.role);

  const load = () => api(`/admin/stats?${qs(f)}`).then((d) => { setData(d); setUpdated(new Date()); });
  useEffect(() => { load(); }, [f]);
  // Live: refresh every 30s and whenever a report notification lands.
  useEffect(() => { const t = setInterval(load, 30e3); return () => clearInterval(t); }, [f]);
  useEffect(() => onNotification(() => load()), [f]);
  useEffect(() => { if (!scoped && can('reports')) api('/admin/reports/filters').then((r) => setTeams(r.teamLeaders)); }, []);

  if (!data) return <><PageHead title="Statistics" /><Spinner /></>;
  const t = data.totals;
  const series = withSentiment(data.daily);
  const periodData = period === 'daily' ? data.daily : period === 'weekly' ? data.weekly : data.monthly;
  return (
    <>
      <PageHead title="Statistics" sub={`${scoped ? 'Your team' : f.teamLeaderId ? 'Selected team' : 'Platform-wide'} · ${data.range.from} → ${data.range.to}`}>
        <span className="small muted"><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: 'var(--success)', marginRight: 6 }} />Live · updated {updated?.toLocaleTimeString()}</span>
        <button className="btn ghost sm" onClick={load}><Icon name="refresh" size={15} /> Refresh</button>
      </PageHead>
      <div className="tabs" style={{ marginBottom: 16 }}>
        {[['platform', 'Platform'], ['mood', 'Mood & activity']].map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'platform' ? <PlatformOverview /> : <>
      <RangeFilters value={f} onChange={setF} teams={scoped ? null : teams} />

      <div className="grid g4">
        <Tile icon="users" label="Registered users" value={t.registered} detail={`${t.disabled} deactivated`} />
        <Tile icon="check" label="Active users" value={t.active} detail={`Active in the last ${t.activeWindowDays} days`} tint="var(--success)" />
        <Tile icon="clock" label="Inactive users" value={t.inactive} detail={`${t.registered ? Math.round((t.inactive / t.registered) * 100) : 0}% of registered`} tint="var(--warn)" />
        <Tile icon="sparkle" label="Avg. daily participation" value={`${data.avgParticipation}%`} detail={`${data.totalSelections} mood selections in range`} />
      </div>

      <div className="grid g3" style={{ marginTop: 16 }}>
        <div className="card stat">
          <div className="k">Most selected mood</div>
          {data.mostSelected ? <><div className="v">{data.mostSelected.emoji} {data.mostSelected.label}</div><div className="d">{data.mostSelected.count} selections · {data.mostSelected.pct}%</div></> : <div className="v muted">-</div>}
        </div>
        <div className="card stat">
          <div className="k">Least selected mood</div>
          {data.leastSelected ? <><div className="v">{data.leastSelected.emoji} {data.leastSelected.label}</div><div className="d">{data.leastSelected.count} selections · {data.leastSelected.pct}%</div></> : <div className="v muted">-</div>}
        </div>
        <div className="card stat">
          <div className="k">Positive mood share</div>
          <div className="v">{data.positiveShare}%</div>
          <div className="d">Happy, excited, energetic, chill & curious</div>
        </div>
      </div>

      <div className="grid g3" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head"><h3>Mood distribution</h3><button className="link-btn small" onClick={() => setAsTable(!asTable)}>{asTable ? 'Chart view' : 'Table view'}</button></div>
          <p className="hint">Share of all mood selections in the range</p>
          {data.totalSelections ? <MoodDistribution distribution={data.distribution} asTable={asTable} /> : <p className="muted">No moods logged in this range yet.</p>}
        </div>
        <div className="card span2">
          <div className="card-head"><h3>Mood statistics</h3>
            <div className="tabs" style={{ margin: 0 }}>
              {['daily', 'weekly', 'monthly'].map((p) => <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>{p[0].toUpperCase() + p.slice(1)}</button>)}
            </div>
          </div>
          <p className="hint">{period === 'daily' ? 'Mood selections per day (selected range)' : period === 'weekly' ? 'Mood selections per week (last 12 weeks)' : 'Mood selections per month (last 12 months)'} · hover a bar for its top moods</p>
          <TotalsBars data={periodData} height={260} />
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Mood trends over time</h3>
          <p className="hint">Daily selections grouped by sentiment</p>
          <Lines data={series} series={SENTIMENT.map((s) => ({ key: s.key, name: s.label, slot: s.slot }))} />
        </div>
        <div className="card">
          <h3>Daily participation</h3>
          <p className="hint">% of active users who logged a mood each day</p>
          <Lines data={data.participation} series={[{ key: 'pct', name: 'Participation', slot: 's1', unit: '%' }]} unit="%" />
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>User activity</h3>
          <p className="hint">Logins and distinct active users per day</p>
          <Lines data={data.activity} series={[{ key: 'logins', name: 'Logins', slot: 's1' }, { key: 'activeUsers', name: 'Active users', slot: 's2' }]} />
        </div>
        <div className="card">
          <h3>Engagement</h3>
          <p className="hint">Activity totals in the selected range</p>
          <div className="grid g3" style={{ gap: 10 }}>
            {[['Posts', 'image', data.engagement.posts], ['Comments', 'comment', data.engagement.comments], ['Likes', 'heart', data.engagement.likes],
              ['Mood Stories', 'sparkle', data.engagement.stories], ['Messages', 'chat', data.engagement.messages], ['Logins', 'key', data.engagement.logins],
              ['Work posts', 'briefcase', data.engagement.workPosts], ['Location stories', 'location', data.engagement.locationStories], ['Trips', 'route', data.engagement.trips]].map(([k, i, v]) => (
              <div key={k} style={{ padding: 12, borderRadius: 12, background: 'var(--panel-2)' }}>
                <div className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Icon name={i} size={14} /> {k}</div>
                <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      </>}
    </>
  );
}
