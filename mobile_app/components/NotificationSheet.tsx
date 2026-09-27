/**
 * Home notification centre.
 *
 * Built entirely from data the app already has — recent activities, earned
 * badges, recommendations, open quizzes with deadlines, and (for group admins)
 * pending join requests. There is no notifications table in the backend, so
 * nothing is marked read; this is a live view, not an inbox.
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
import { useNotificationReadState } from '@/hooks/useNotificationRead';

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

export type NotificationKind = 'activity' | 'badge' | 'recommendation' | 'deadline' | 'join_request';

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
  const [loading, setLoading] = useState(false);

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
    } finally {
      setLoading(false);
    }
  }, []);

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
      });
    }

    for (const r of recommendations.slice(0, 5)) {
      // Prefer the server's href, fall back to the course path, then
      // Activities. Every card used to point at Activities regardless of what
      // it recommended, so tapping a course suggestion was a no-op detour.
      const href =
        r.href ||
        (r.course_id ? `/(tabs)/course/path/${r.course_id}` : '/(tabs)/activities');
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
      });
    }

    return out;
  }, [activities, badges, recommendations, quizzes, joinRequests]);

  const itemIds = useMemo(() => items.map((n) => n.id), [items]);
  const { isUnread, markAllRead, unreadCount } = useNotificationReadState(itemIds);

  // The bell badge lives in the Dashboard header, outside this sheet. Report
  // the count up rather than recomputing it there: this sheet is the only
  // place that sees quizzes and join requests, so recomputing in the header
  // would silently undercount.
  useEffect(() => {
    onUnreadChange?.(unreadCount);
  }, [unreadCount, onUnreadChange]);

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close notifications" />

      <View style={[styles.sheet, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Text style={styles.title}>Notifications</Text>
          <View style={styles.headerActions}>
            {unreadCount > 0 && (
              <TouchableOpacity
                onPress={markAllRead}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={`Mark all ${unreadCount} notifications as read`}
              >
                <Text style={styles.clearAll}>Clear all</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {loading && items.length === 0 ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={COLORS.purpleVibrant} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="notifications-off-outline" size={40} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>Nothing new right now.</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
            {items.map((n) => {
              const unread = isUnread(n.id);
              return (
                <TouchableOpacity
                  key={n.id}
                  style={[styles.row, n.urgent && styles.rowUrgent, unread && styles.rowUnread]}
                  activeOpacity={0.75}
                  onPress={() => {
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
