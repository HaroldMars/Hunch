import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { api } from '../api.js';
import { useApp, useSocket } from '../store.jsx';
import { Avatar, TopBar, Spinner, Empty, Sheet, timeAgo } from '../components/ui.jsx';

export const NOTIF_STYLE = {
  like: { icon: 'heart', color: '#ff4d6d' },
  comment: { icon: 'comment', color: '#5b8def' },
  reply: { icon: 'reply', color: '#5b8def' },
  repost: { icon: 'repost', color: '#3ddc84' },
  friend_request: { icon: 'userPlus', color: '#a78bfa' },
  friend_accept: { icon: 'userCheck', color: '#3ddc84' },
  message: { icon: 'chat', color: '#5b8def' },
  story_reaction: { icon: 'sparkle', color: '#ff8a3d' },
  announcement: { icon: 'megaphone', color: '#ffc83d' },
  app_update: { icon: 'refresh', color: '#2ec4b6' },
  email: { icon: 'mail', color: '#7c8db5' },
  system: { icon: 'shield', color: '#7c8db5' },
};

export default function Notifications() {
  const { refreshUnread } = useApp();
  const nav = useNavigate();
  const [list, setList] = useState(null);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const load = () => api('/notifications').then(setList);
  useEffect(() => { load(); }, []);
  useSocket('notification:new', (n) => setList((l) => (l ? [n, ...l.filter((x) => x.id !== n.id)] : l)));

  const open = async (n) => {
    if (!n.is_read) {
      api(`/notifications/${n.id}/read`, { method: 'POST' }).then(refreshUnread);
      setList((l) => l.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x)));
    }
    if (n.entity_type === 'highlight') nav(`/me?highlight=${n.entity_id}`);
    else if (['like', 'comment', 'reply', 'repost', 'mention', 'comment_reaction', 'work_post', 'work_announcement'].includes(n.type)) nav(`/post/${n.entity_id}`);
    else if (n.type === 'schedule') nav('/?tab=work&view=schedule');
    else if (n.type === 'post_permission') nav('/?tab=work');
    else if (n.type === 'trip') nav(`/map?trip=${n.entity_id}`);
    else if (n.type === 'friend_request') nav('/connect');
    else if (n.type === 'friend_accept') nav(`/u/${n.actor_id}`);
    else if (n.type === 'message') nav(`/chats/${n.entity_id}`);
    else if (n.type === 'story_reaction') nav('/archive');
    else setDetail(n);
  };
  const readAll = async () => {
    await api('/notifications/read-all', { method: 'POST' });
    setList((l) => l.map((x) => ({ ...x, is_read: x.type === 'message' ? x.is_read : 1 })));
    refreshUnread();
  };
  const FILTERS = { all: 'All', social: 'Activity', friends: 'Friends', updates: 'Updates' };
  const shown = (list || []).filter((n) => n.type !== 'message' && (
    filter === 'all' || (filter === 'social' && ['like', 'comment', 'reply', 'repost', 'story_reaction'].includes(n.type))
    || (filter === 'friends' && n.type.startsWith('friend')) || (filter === 'updates' && ['announcement', 'app_update', 'email', 'system'].includes(n.type))));

  return (
    <div className="page flush">
      <TopBar title="Notifications" back><button className="link-btn small" onClick={readAll}>Mark all read</button></TopBar>
      <div style={{ display: 'flex', gap: 6, padding: '0 16px 8px', overflowX: 'auto' }}>
        {Object.entries(FILTERS).map(([k, v]) => (
          <button key={k} className={`btn sm ${filter === k ? '' : 'ghost'}`} style={{ borderRadius: 20 }} onClick={() => setFilter(k)}>{v}</button>
        ))}
      </div>
      {list === null ? <Spinner /> : !shown.length ? <Empty icon="bell" title="You're all caught up">New likes, comments, friend requests and updates show up here.</Empty> : shown.map((n) => {
        const st = NOTIF_STYLE[n.type] || NOTIF_STYLE.system;
        return (
          <button key={n.id} className={`notif ${n.is_read ? '' : 'unread'}`} onClick={() => open(n)}>
            <div className="avatar-wrap">
              {n.actor_id ? <Avatar src={n.actor_avatar} size={44} /> : <div className="avatar" style={{ width: 44, height: 44, background: st.color, color: '#fff' }}><Icon name={st.icon} size={22} /></div>}
              {n.actor_id && <span className="ico" style={{ background: st.color }}><Icon name={st.icon} size={11} stroke={2.4} /></span>}
            </div>
            <div className="txt">
              {['announcement', 'app_update'].includes(n.type) ? <><b>{n.type === 'app_update' ? 'App update: ' : '📣 '}{n.title}</b><div style={{ color: 'var(--text-2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.body}</div></> : n.body}
              <div className="time">{timeAgo(n.created_at)}</div>
            </div>
            {!n.is_read && <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--primary)', marginTop: 8 }} />}
          </button>
        );
      })}
      {detail && (
        <Sheet title={detail.title || 'Notification'} onClose={() => setDetail(null)} center>
          <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5, margin: 0 }}>{detail.body}</p>
          <p className="small muted">{detail.actor_name ? `From ${detail.actor_name} · ` : ''}{new Date(detail.created_at).toLocaleString()}</p>
        </Sheet>
      )}
    </div>
  );
}
