import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Favicon } from '@/components/Favicon';
import {
  IconChevronDown,
  IconChevronRight,
  IconInbox,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconRss,
  IconSettings,
  IconStar,
} from '@/components/icons';
import { Spinner } from '@/components/Spinner';
import { useLibrary } from '@/hooks/useLibrary';
import { setCollapsed } from '@/lib/storage/categories';
import { displayTitle } from '@/lib/storage/feeds';
import { sendMessage } from '@/lib/messaging';
import type { Category, Feed } from '@/lib/types';
import { useToast } from './Toasts';
import { AddFeedDialog } from './AddFeedDialog';
import { FeedEditDialog } from './FeedEditDialog';

export function Sidebar() {
  const { grouped, totalUnread, unreadForFeeds, loading, refreshCounts } = useLibrary();
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingFeed, setEditingFeed] = useState<Feed | null>(null);

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      const res = await sendMessage('feeds:refresh', {});
      await refreshCounts();
      toast(
        res.failed > 0
          ? `Refreshed ${res.refreshed}, ${res.failed} failed`
          : `Refreshed ${res.refreshed} feed${res.refreshed === 1 ? '' : 's'}`,
        res.failed > 0 ? 'error' : 'success',
      );
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-elevated)] backdrop-blur-xl">
      <div className="flex items-center gap-2 px-3.5 py-3">
        <IconRss size={18} className="text-[var(--accent)]" />
        <span className="flex-1 text-[14px] font-semibold tracking-tight">Perch</span>
        <button
          onClick={refreshAll}
          disabled={refreshing}
          title="Refresh all feeds"
          className="rounded-md p-1.5 text-[var(--text-faint)] hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] hover:text-[var(--text)]"
        >
          {refreshing ? <Spinner size={15} /> : <IconRefresh size={16} />}
        </button>
        <NavLink
          to="/settings"
          title="Settings"
          className="rounded-md p-1.5 text-[var(--text-faint)] hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] hover:text-[var(--text)]"
        >
          <IconSettings size={16} />
        </NavLink>
      </div>

      <nav className="flex flex-col gap-0.5 px-2 pb-1">
        <SidebarLink to="/" icon={<IconInbox size={16} />} label="All Feeds" count={totalUnread} />
        <SidebarLink to="/starred" icon={<IconStar size={16} />} label="Starred" />
      </nav>

      <div className="mt-1 flex-1 overflow-y-auto px-2 pb-3">
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          grouped.map(({ category, feeds }) => (
            <CategoryGroup
              key={category.id}
              category={category}
              feeds={feeds}
              unreadForFeeds={unreadForFeeds}
              onEditFeed={setEditingFeed}
            />
          ))
        )}
      </div>

      <div className="border-t border-[var(--border)] p-2">
        <button
          onClick={() => setAdding(true)}
          className="flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-[12.5px] font-medium text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] hover:text-[var(--text)]"
        >
          <IconPlus size={15} /> Add feed
        </button>
      </div>

      {adding && <AddFeedDialog onClose={() => setAdding(false)} />}
      {editingFeed && (
        <FeedEditDialog
          feed={editingFeed}
          onClose={() => {
            setEditingFeed(null);
            void refreshCounts();
          }}
        />
      )}
    </aside>
  );
}

function SidebarLink({
  to,
  icon,
  label,
  count,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[13px] font-medium transition-colors ${
          isActive
            ? 'bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--text)]'
            : 'text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] hover:text-[var(--text)]'
        }`
      }
    >
      <span className="text-[var(--text-faint)]">{icon}</span>
      <span className="flex-1">{label}</span>
      {count ? <UnreadPill n={count} /> : null}
    </NavLink>
  );
}

function CategoryGroup({
  category,
  feeds,
  unreadForFeeds,
  onEditFeed,
}: {
  category: Category;
  feeds: Feed[];
  unreadForFeeds: (ids: string[]) => number;
  onEditFeed: (feed: Feed) => void;
}) {
  const [collapsed, setLocalCollapsed] = useState(!!category.collapsed);
  const unread = unreadForFeeds(feeds.map((f) => f.id));

  const toggle = () => {
    const next = !collapsed;
    setLocalCollapsed(next);
    void setCollapsed(category.id, next);
  };

  return (
    <div className="mt-2 first:mt-1">
      <div className="group flex items-center gap-1 px-1">
        <button
          onClick={toggle}
          className="flex flex-1 items-center gap-1 rounded-md py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] hover:text-[var(--text-muted)]"
        >
          {collapsed ? <IconChevronRight size={13} /> : <IconChevronDown size={13} />}
          <NavLink
            to={`/category/${category.id}`}
            onClick={(e) => e.stopPropagation()}
            className="truncate hover:text-[var(--text)]"
          >
            {category.name}
          </NavLink>
          <span className="flex-1" />
          {unread > 0 && <span className="normal-case text-[var(--text-faint)]">{unread}</span>}
        </button>
      </div>

      {!collapsed && (
        <div className="mt-0.5 flex flex-col">
          {feeds.length === 0 ? (
            <p className="px-3 py-1.5 text-[11.5px] text-[var(--text-faint)]">No feeds yet</p>
          ) : (
            feeds.map((feed) => (
              <FeedRow
                key={feed.id}
                feed={feed}
                unread={unreadForFeeds([feed.id])}
                onEdit={() => onEditFeed(feed)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function FeedRow({ feed, unread, onEdit }: { feed: Feed; unread: number; onEdit: () => void }) {
  return (
    <div className="group relative flex items-center">
      <NavLink
        to={`/feed/${feed.id}`}
        className={({ isActive }) =>
          `flex min-w-0 flex-1 items-center gap-2 rounded-[9px] py-1.5 pl-3 pr-2 text-[12.5px] transition-colors ${
            isActive
              ? 'bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--text)]'
              : 'text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] hover:text-[var(--text)]'
          }`
        }
      >
        <Favicon feed={feed} size={15} />
        <span
          className={`min-w-0 flex-1 truncate ${unread > 0 ? 'font-medium text-[var(--text)]' : ''}`}
        >
          {displayTitle(feed)}
        </span>
        {feed.needsPermission && (
          <span title="Needs site access" className="text-[#f59e0b]">
            !
          </span>
        )}
        {unread > 0 && (
          <span className="text-[11px] text-[var(--text-faint)] group-hover:hidden">{unread}</span>
        )}
      </NavLink>
      <button
        onClick={onEdit}
        title="Edit feed"
        className="absolute right-1.5 hidden rounded-md p-1 text-[var(--text-faint)] hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)] hover:text-[var(--text)] group-hover:block"
      >
        <IconPencil size={13} />
      </button>
    </div>
  );
}

function UnreadPill({ n }: { n: number }) {
  return (
    <span className="min-w-[18px] rounded-full bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] px-1.5 text-center text-[11px] font-semibold text-[var(--text)]">
      {n > 999 ? '999+' : n}
    </span>
  );
}
