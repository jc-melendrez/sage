/**
 * Home notification centre.
 *
 * Built entirely from data the app already has — recent activities, earned
 * badges, recommendations, open quizzes with deadlines, class tasks and (for
 * group admins) pending join requests. There is no notifications table in the
 * backend, so "read" lives in AsyncStorage via useNotificationRead; this is a
 * live view, not an inbox.
 *
 * Renders as an in-tree overlay rather than a <Modal>: Android silently drops
 * a Modal stacked on another, which is what broke the other action menus.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiCall } from '@/services/apiClient';
import { getQuizzes, type Quiz } from '@/services/quizService';
import { describeDue } from '@/services/dueDate';
import { getEnrolledCourses } from '@/services/courseService';
import { getCourseActivities, type ClassActivity } from '@/services/activityService';
import { useNotificationReadState, type NotificationKey } from '@/hooks/useNotificationRead';

const COLORS = {
  bg: '#FFFFFF',
  surface: '#F5F3FA',
  purpleDeep: '#4C1D95',
  purpleDark: '#6D28D9',
  purpleVibrant: '#8B5CF6',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  textPrimary: '#3a107a',
  textMuted: '#6B7280',
  border: 'rgba(124, 58, 237, 0.12)',
};

const FONTS = {
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

export type NotificationKind =
  | 'activity'
  | 'badge'
  | 'recommendation'
  | 'deadline'
  | 'task'
  | 'join_request';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  icon: any;
  color: string;
  title: string;
  body: string;
  /** Relative time for recent items; the due label for deadlines. */
  time: string;
  /** Optional deep link, e.g. '/(tabs)/activities'. */
  href?: string;
  urgent?: boolean;
  /**
   * Epoch ms the underlying record was created, for rows whose identity is
   * their creation. Feeds the read watermark; omit it for rows that represent
   * a change in state (a deadline inside a day, a pending join request).
   */
  createdAt?: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Route to open when a notification is tapped. */
  onOpenHref?: (href: string) => void;
  activities?: any[];
  badges?: any[];
  recommendations?: any[];
  /** Reports the unread count so the header bell can badge itself. */
  onUnreadChange?: (count: number) => void;
}

interface GroupRow {
  id: string;
  privacy?: string;
  members?: any[];
  join_requests?: any[];
  created_by?: string;
}

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Epoch ms for an ISO timestamp, or undefined when it is absent or unparsable. */
function toEpoch(iso?: string | null): number | undefined {
  if (!iso) return undefined;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

export default function NotificationSheet({
  visible,
  onClose,
  onOpenHref,
  activities = [],
  badges = [],
  recommendations = [],
  onUnreadChange,
}: Props) {
  const insets = useSafeAreaInsets();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [joinRequests, setJoinRequests] = useState<{ groupId: string; groupName: string; displayName: string }[]>([]);
  const [tasks, setTasks] = useState<ClassActivity[]>([]);
  const [loading, setLoading] = useState(false);
  // True once the lazy sources have landed at least once. The badge only
  // reports while this is set and no fetch is running, so it never publishes
  // a count taken from a half-loaded list.
  const [settled, setSettled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getQuizzes().catch(() => [] as Quiz[]);
      setQuizzes(list);

      // Group admins get pending join requests. Only their own groups are
      // queried, and any failure just means no section.
      const groups = await apiCall<GroupRow[]>('/users/groups/mine/', { noCache: true })
        .catch(() => [] as GroupRow[]);
      const pending: { groupId: string; groupName: string; displayName: string }[] = [];
      for (const g of groups) {
        if (!g?.id) continue;
        const detail = await apiCall<GroupRow>(`/users/groups/${g.id}/members/`, { noCache: true })
          .catch(() => null);
        const mine = detail?.join_requests ?? [];
        for (const r of mine) {
          pending.push({
            groupId: g.id,
            groupName: (g as any).name || 'your group',
            displayName: r.display_name || r.username || 'Someone',
          });
        }
      }
      setJoinRequests(pending);

      // Class tasks the student has been set. Published ones only (a draft is
      // not news), fetched per enrolled course -- `apiCall` caches these reads
      // for ten minutes, so reopening the bell is cheap.
      const courses = await getEnrolledCourses().catch(() => []);
      const perCourse = await Promise.all(
        courses.slice(0, 12).map(async (course) => {
          const acts = await getCourseActivities(course.id).catch(() => [] as ClassActivity[]);
          return acts
            .filter((a) => a?.kind === 'task' && a.status === 'published')
            .map((a) => ({ ...a, course_name: a.course_name || course.name }));
        }),
      );
      setTasks(perCourse.flat());
      setSettled(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Kick off once on mount, not only when the sheet opens: the badge lives in
  // the Dashboard header and has to know about deadlines, tasks and join
  // requests without the user opening this sheet first. Re-opening still
  // refetches so a stale count cannot survive.
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const items = useMemo<AppNotification[]>(() => {
    const out: AppNotification[] = [];

    // Pending admin actions first — these are the only ones that time out.
    for (const r of joinRequests) {
      out.push({
        id: `join-${r.groupId}-${r.displayName}`,
        kind: 'join_request',
        icon: 'person-add',
        color: COLORS.purpleVibrant,
        title: `${r.displayName} wants to join ${r.groupName}`,
        body: 'Review the request in Groups.',
        time: 'Pending',
        href: '/(tabs)/activities',
        urgent: true,
      });
    }

    // Class tasks. One row per task: "new" while the assignment is fresh,
    // "due soon" once the deadline is inside a day (or overdue), never both --
    // two rows for the same assignment would read as a bug. The due row
    // deliberately carries NO `createdAt`, because crossing the one-day line
    // has to light the bell even though the task was created before the last
    // "mark all".
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    for (const t of tasks) {
      const due = t.due_date ? describeDue(t.due_date) : null;
      const createdAt = toEpoch(t.created_at);
      const overdue = !!due?.isOverdue;
      const dueSoon = !!due && !overdue && due.daysLeft <= 1;
      const fresh = createdAt != null && now - createdAt <= 14 * DAY_MS;
      if (!overdue && !dueSoon && !fresh) continue;

      const dueRow = overdue || dueSoon;
      out.push({
        id: dueRow ? `task-due-${t.id}` : `task-new-${t.id}`,
        kind: 'task',
        icon: dueRow ? 'alarm' : 'document-text',
        color: overdue ? COLORS.danger : dueSoon ? COLORS.purpleVibrant : COLORS.success,
        title: dueRow ? t.title : `New task: ${t.title}`,
        body: [
          t.course_name,
          !dueRow && due ? `Due ${due.short}` : null,
        ].filter(Boolean).join(' · '),
        time: dueRow && due ? due.label : relativeTime(t.created_at),
        href: `/(tabs)/course/task/${t.id}`,
        urgent: dueRow,
        createdAt: dueRow ? undefined : createdAt,
      });
    }

    // Open quizzes with a deadline, soonest first.
    const withDeadlines = quizzes
      .filter((q) => q.available_until)
      .map((q) => ({ q, due: describeDue(q.available_until) }))
      .filter(({ due }) => due.daysLeft <= 14)
      .sort((a, b) => a.due.daysLeft - b.due.daysLeft);

    for (const { q, due } of withDeadlines) {
      out.push({
        id: `quiz-${q.id}`,
        kind: 'deadline',
        icon: 'alarm',
        color: due.isOverdue ? COLORS.danger : COLORS.warning,
        title: q.title,
        body: due.isOverdue ? 'This quiz has closed.' : `Quiz ${due.label.toLowerCase()}.`,
        time: due.label,
        href: '/(tabs)/activities',
        urgent: due.daysLeft <= 1,
      });
    }

    for (const b of badges.slice(0, 10)) {
      out.push({
        id: `badge-${b.id}`,
        kind: 'badge',
        icon: 'trophy',
        color: COLORS.warning,
        title: `Badge earned: ${b.name || 'Achievement'}`,
        body: 'Nice work — it has been added to your profile.',
        time: relativeTime(b.earned_at || b.awarded_at),
        href: '/(tabs)/profile',
        createdAt: toEpoch(b.earned_at || b.awarded_at),
      });
    }

    for (const r of recommendations.slice(0, 5)) {
      // Prefer the server's href, then the course path. A recommendation with
      // no resolvable course goes to the dashboard, which is where "For You"
      // lives -- not to Activities, which is an unrelated screen and read as
      // a broken tap. The dashboard's own Start button handles the
      // course-less case properly.
      const href =
        r.href ||
        (r.course_id ? `/(tabs)/course/path/${r.course_id}` : '/(tabs)/dashboard');
      out.push({
        id: `rec-${r.id}`,
        kind: 'recommendation',
        icon: 'sparkles',
        color: COLORS.purpleVibrant,
        title: r.title || 'Recommended for you',
        body: r.description || 'A new suggestion is waiting.',
        time: 'Suggested',
        href,
      });
    }

    for (const a of activities.slice(0, 10)) {
      out.push({
        id: `act-${a.id}`,
        kind: 'activity',
        icon: 'checkmark-circle',
        color: COLORS.success,
        title: a.title || 'Activity completed',
        body: [
          a.course_name,
          a.xp_earned ? `+${a.xp_earned} XP` : null,
        ].filter(Boolean).join(' · ') || a.description || 'Keep it up.',
        time: relativeTime(a.created_at),
        href: a.payload?.route || '/(tabs)/activities',
        createdAt: toEpoch(a.created_at),
      });
    }

    return out;
  }, [activities, badges, recommendations, quizzes, joinRequests, tasks]);

  const keys = useMemo<NotificationKey[]>(
    () => items.map((n) => ({ id: n.id, createdAt: n.createdAt })),
    [items],
  );
  const { isUnread, isHidden, markAllRead, markRead, clearRead, unreadCount, hydrated } =
    useNotificationReadState(keys);

  // "Clear all" only sweeps read rows, so the list is what remains once the
  // hidden (already-cleared) ids are dropped.
  const visibleItems = useMemo(() => items.filter((n) => !isHidden(n.id)), [items, isHidden]);
  const hasReadRows = useMemo(
    () => hydrated && visibleItems.some((n) => !isUnread(n.id, n.createdAt)),
    [hydrated, visibleItems, isUnread],
  );

  // The bell badge lives in the Dashboard header, outside this sheet. Report
  // the count up rather than recomputing it there: this sheet is the only
  // place that sees quizzes, tasks and join requests, so recomputing in the
  // header would silently undercount.
  //
  // Only once the lazy sources have landed and no fetch is running. Reporting
  // mid-load published a count taken from half a list, which then jumped the
  // moment the rest arrived.
  useEffect(() => {
    if (!settled || loading) return;
    onUnreadChange?.(unreadCount);
  }, [unreadCount, onUnreadChange, settled, loading]);

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close notifications" />

      <View style={[styles.sheet, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Text style={styles.title}>Notifications</Text>
          <View style={styles.headerActions}>
            {/* No `!loading` gate: it used to hide the button until every lazy
                source (quizzes, groups, courses, tasks) had resolved, which is
                why it took a beat to appear. The hook reports 0 until storage
                hydrates, and the `clearedAt` watermark keeps late-arriving
                createdAt rows from re-lighting, so showing it as soon as there
                is an unread row is honest. */}
            {unreadCount > 0 && (
              <TouchableOpacity
                onPress={markAllRead}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={`Mark all ${unreadCount} notifications as read`}
              >
                <Text style={styles.clearAll}>Mark all as read</Text>
              </TouchableOpacity>
            )}
            {hasReadRows && (
              <TouchableOpacity
                onPress={clearRead}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Clear read notifications"
              >
                <Text style={styles.clearAll}>Clear all</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {loading && visibleItems.length === 0 ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={COLORS.purpleVibrant} />
          </View>
        ) : visibleItems.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="notifications-off-outline" size={40} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>Nothing new right now.</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
            {visibleItems.map((n) => {
              const unread = isUnread(n.id, n.createdAt);
              return (
                <TouchableOpacity
                  key={n.id}
                  style={[styles.row, n.urgent && styles.rowUrgent, unread && styles.rowUnread]}
                  activeOpacity={0.75}
                  onPress={() => {
                    // Opened means seen; without this the row stayed unread
                    // forever unless the user pressed "mark all".
                    markRead(n.id);
                    onClose();
                    if (n.href && onOpenHref) onOpenHref(n.href);
                  }}
                >
                  <View style={[styles.iconBox, { backgroundColor: n.color + '1A' }]}>
                    <Ionicons name={n.icon} size={17} color={unread ? n.color : COLORS.textMuted} />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowTitle, unread && styles.rowTitleUnread]} numberOfLines={2}>{n.title}</Text>
                    <Text style={styles.rowSub} numberOfLines={2}>{n.body}</Text>
                    {n.time ? <Text style={[styles.rowTime, n.urgent && { color: n.color }]}>{n.time}</Text> : null}
                  </View>
                  {unread && <View style={styles.unreadDot} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '78%',
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingBottom: 28,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: { fontSize: 18, fontFamily: FONTS.extraBold, fontWeight: '800', color: COLORS.textPrimary },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  clearAll: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purpleVibrant },
  loadingBox: { paddingVertical: 40, alignItems: 'center' },
  emptyBox: { paddingVertical: 40, alignItems: 'center', gap: 10 },
  emptyText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textMuted },
  list: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  row: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  rowUrgent: { borderColor: COLORS.purpleVibrant + '66' },
  rowUnread: { backgroundColor: COLORS.purpleVibrant + '0A' },
  rowTitleUnread: { color: COLORS.textPrimary },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.purpleVibrant,
    alignSelf: 'center',
  },
  iconBox: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  rowSub: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted, marginTop: 3, lineHeight: 17 },
  rowTime: { fontSize: 11, fontFamily: FONTS.semiBold, color: COLORS.purpleVibrant, marginTop: 5 },
});
