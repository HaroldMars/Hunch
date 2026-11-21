import { useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { TopBar, Spinner, Empty, useLoad } from '../components/ui.jsx';
import { PostCard, CommentThread } from '../components/Post.jsx';

/** Threads-style post page: the post, its replies inline, and a fixed "Add your reply…" bar. */
export default function PostPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const focus = useRef(null);
  const { data, loading, error } = useLoad(() => api(`/posts/${id}`), [id]);
  const post = data && data.repost_of && data.original && !data.original.unavailable ? data.original : data;
  return (
    <div className="page flush thread-page">
      <TopBar title={<div className="thread-title"><b>Thread</b>{post && <span>{post.comments} {post.comments === 1 ? 'reply' : 'replies'}</span>}</div>} back />
      {loading ? <Spinner /> : error ? <Empty icon="lock" title="Post unavailable">{error.message}</Empty> : (
        <>
          <PostCard post={post} detail onComment={() => focus.current?.()} onDeleted={() => nav('/')} />
          <CommentThread key={post.id} post={post} focusRef={focus} />
        </>
      )}
    </div>
  );
}
