import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint, SPACE, TYPE } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { StatCard, SectionHeader, FilterChip, EmptyState } from '@/components/educator/EducatorPrimitives';
import { CourseStudentRow, StudentRosterMenu, StudentAnchor } from '@/components/educator/CourseStudentRow';
import { KeyboardSafeView } from '@/components/KeyboardSafeView';
import { useEducatorBack } from '@/hooks/useEducatorBack';
import {
  getCourse,
  getCourseLeaderboard,
  getCoursePath,
  removeStudentFromCourse,
  CourseLeaderboard,
  CourseRoster,
} from '@/services/courseService';
import {
  buildStudentRows,
  summarizeRoster,
  matchesQuery,
  CourseStudentRow as StudentRow,
  StudentHealth,
} from '@/services/courseRoster';

type HealthFilter = 'all' | StudentHealth;

const HEALTH_FILTERS: { key: HealthFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'onTrack', label: 'On track' },
  { key: 'atRisk', label: 'At risk' },
  { key: 'needsAttention', label: 'Watch' },
  { key: 'neverStarted', label: 'Not started' },
];

/** Leaderboard entries are per-student but nodes are per-topic; the course
 *  total is the denominator for every completion percentage. */
function countNodes(topics: Awaited<ReturnType<typeof getCoursePath>>): number {
  return topics.reduce((sum, topic) => sum + topic.nodes.length, 0);
}

export default function CourseStudentsScreen() {
  const { courseId, courseName } = useLocalSearchParams<{ courseId: string; courseName: string }>();
  const cid = Number(courseId);

  const [roster, setRoster] = useState<CourseRoster | null>(null);
  const [leaderboard, setLeaderboard] = useState<CourseLeaderboard | null>(null);
  const [totalNodes, setTotalNodes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<HealthFilter>('all');

  const [removingId, setRemovingId] = useState<number | null>(null);
  const [menuStudent, setMenuStudent] = useState<StudentRow | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<StudentAnchor | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The roster is the only hard requirement. The leaderboard supplies the
      // per-student stats, so a failure there degrades those rows to zeros
      // rather than hiding the students themselves; the path only supplies the
      // completion denominator.
      const [course, board] = await Promise.all([
        getCourse(cid),
        getCourseLeaderboard(cid).catch(() => null),
      ]);
      setRoster(course);
      setLeaderboard(board);

      getCoursePath(cid)
        .then((topics) => setTotalNodes(countNodes(topics)))
        .catch(() => setTotalNodes(0));
    } catch (err: any) {
      setError(err?.message ?? 'Could not load this class.');
    } finally {
      setLoading(false);
    }
  }, [cid]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const rows = useMemo(
    () => buildStudentRows(roster, leaderboard, totalNodes),
    [roster, leaderboard, totalNodes],
  );
  const summary = useMemo(() => summarizeRoster(rows), [rows]);

  const filtered = useMemo(
    () => rows.filter((r) => (filter === 'all' || r.health === filter) && matchesQuery(r, query)),
    [rows, filter, query],
  );

  const flashCopied = useCallback(() => {
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1800);
  }, []);

  const copyText = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
  }, []);

  const onCopyJoinCode = useCallback(async () => {
    if (!roster?.join_code) return;
    await copyText(roster.join_code);
    flashCopied();
  }, [copyText, flashCopied, roster]);

  const onCopyEmail = useCallback(async (student: StudentRow) => {
    await copyText(student.email);
    flashCopied();
  }, [copyText, flashCopied]);

  const doRemove = useCallback(async (student: StudentRow) => {
    setRemovingId(student.id);
    try {
      // remove-student returns the refreshed roster, so membership updates
      // without a refetch. The leaderboard is keyed by student id and still
      // lists them, so it has to be re-read separately.
      setRoster(await removeStudentFromCourse(cid, student.id));
      getCourseLeaderboard(cid).then(setLeaderboard).catch(() => {});
    } catch (err: any) {
      Alert.alert('Could not remove student', err?.message ?? 'Please try again.');
    } finally {
      setRemovingId(null);
    }
  }, [cid]);

  const confirmRemove = useCallback((student: StudentRow) => {
    Alert.alert(
      `Remove ${student.name}?`,
      `They lose access to this class, its content and its class chat. Their account, XP and any other classes are untouched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => doRemove(student) },
      ],
    );
  }, [doRemove]);

  const closeMenu = useCallback(() => {
    setMenuStudent(null);
    setMenuAnchor(null);
  }, []);

  const openMenu = useCallback((student: StudentRow, anchor: StudentAnchor) => {
    if (menuStudent?.id === student.id) {
      setMenuStudent(null);
      setMenuAnchor(null);
      return;
    }
    setMenuStudent(student);
    setMenuAnchor(anchor);
  }, [menuStudent]);

  const title = courseName || 'Students';

  // Cold start / deep link: no stack entry to go back to, so land on the course
  // rather than the educator dashboard.
  const backToCourse = useEducatorBack({
    pathname: '/educator/(tabs)/course-detail',
    params: { courseId: String(cid), courseName: courseName || '' },
  } as never);

  return (
    <KeyboardSafeView style={styles.container}>
      <View style={styles.container}>
        <EducatorHeader
          title={title}
          subtitle={loading ? 'Loading class…' : `${summary.total} student${summary.total === 1 ? '' : 's'}`}
          showBack
          onBack={backToCourse}
        />

        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* The join code is the only way onto this roster — there is no
              add-student picker — so it is the screen's primary control. */}
          {roster?.join_code ? (
            <View style={styles.joinCard}>
              <View style={styles.joinTop}>
                <View style={styles.joinIconBg}>
                  <Ionicons name="key" size={18} color={COLORS.purpleVibrant} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.joinLabel}>Join code</Text>
                  <Text style={styles.joinHint}>Students enter this on the Activities tab to enrol.</Text>
                </View>
              </View>
              <View style={styles.joinBottom}>
                <Text style={styles.joinCode} accessibilityLabel={`Join code ${roster.join_code.split('').join(' ')}`}>
                  {roster.join_code}
                </Text>
                <TouchableOpacity
                  style={[styles.copyBtn, copied && styles.copyBtnDone]}
                  activeOpacity={0.8}
                  onPress={onCopyJoinCode}
                  accessibilityRole="button"
                  accessibilityLabel="Copy join code"
                >
                  <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={copied ? COLORS.success : COLORS.purpleDeep} />
                  <Text style={[styles.copyBtnText, copied && { color: COLORS.success }]}>
                    {copied ? 'Copied' : 'Copy'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
            </View>
          ) : error ? (
            <EmptyState
              icon="alert-circle-outline"
              title="Couldn't load this class"
              text={error}
            />
          ) : (
            <>
              <View style={styles.statsRow}>
                <StatCard icon="people" value={summary.total} label="Students" color={COLORS.purpleVibrant} />
                <StatCard icon="trending-up" value={`${summary.averageCompletion}%`} label="Avg done" color={COLORS.success} />
                <StatCard icon="warning" value={summary.atRisk} label="Falling behind" color={COLORS.danger} />
              </View>

              <View style={styles.section}>
                <SectionHeader title="All Students" />
                {summary.total > 0 && (
                  <>
                    <View style={styles.searchBox}>
                      <Ionicons name="search" size={18} color={COLORS.textMuted} />
                      <TextInput
                        style={styles.searchInput}
                        placeholder="Search name, username or email"
                        placeholderTextColor={COLORS.textMuted}
                        value={query}
                        onChangeText={setQuery}
                        autoCorrect={false}
                        autoCapitalize="none"
                      />
                      {query.length > 0 && (
                        <TouchableOpacity onPress={() => setQuery('')} activeOpacity={0.7} hitSlop={8}>
                          <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={styles.filterRow}>
                      {HEALTH_FILTERS.map((f) => (
                        <FilterChip key={f.key} label={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />
                      ))}
                    </View>
                  </>
                )}

                {summary.total === 0 ? (
                  <EmptyState
                    icon="people-outline"
                    title="No students yet"
                    text="Share the join code above. Students appear here as soon as they enrol."
                  />
                ) : filtered.length > 0 ? (
                  <View style={styles.listCard}>
                    {filtered.map((student) => (
                      <CourseStudentRow
                        key={student.id}
                        student={student}
                        onMenu={openMenu}
                      />
                    ))}
                  </View>
                ) : (
                  <EmptyState
                    icon="search-outline"
                    title="No students match"
                    text="Try a different search or filter."
                  />
                )}
              </View>
            </>
          )}
        </ScrollView>

        {/* Mounted once, outside the ScrollView — see StudentRosterMenu's note
            on why this cannot be rendered per row. */}
        <StudentRosterMenu
          student={menuStudent}
          anchor={menuAnchor}
          onClose={closeMenu}
          onCopyEmail={onCopyEmail}
          onRemove={confirmRemove}
        />

        {/* Scrim, not just a spinner: removing is a write, and this blocks a
            double-tap on a second student while it is in flight. */}
        {removingId !== null && (
          <View style={styles.busyOverlay}>
            <View style={styles.busyCard}>
              <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
              <Text style={styles.busyText}>Removing student…</Text>
            </View>
          </View>
        )}
      </View>
    </KeyboardSafeView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: SPACE.xl },
  section: { marginTop: SPACE.xxl },
  loadingBox: { paddingVertical: 60, alignItems: 'center' },

  joinCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACE.lg,
  },
  joinTop: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  joinIconBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: tint(COLORS.purpleVibrant),
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinLabel: { fontSize: TYPE.sm, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary },
  joinHint: { fontSize: TYPE.meta, fontFamily: FONTS.regular, color: COLORS.textSecondary, marginTop: 1 },
  joinBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACE.lg,
  },
  // Wide letter-spacing turns the code into scannable character blocks
  // instead of one ambiguous run — the same treatment courses.tsx uses.
  joinCode: {
    fontSize: 26,
    fontFamily: FONTS.black,
    fontWeight: '900',
    color: COLORS.purpleDeep,
    letterSpacing: 6,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    backgroundColor: tint(COLORS.purplePrimary, 0.12),
  },
  copyBtnDone: { backgroundColor: tint(COLORS.success) },
  copyBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.purpleDeep },

  statsRow: { flexDirection: 'row', gap: 10, marginTop: SPACE.xl },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 14,
  },
  searchInput: { flex: 1, fontSize: TYPE.body, fontFamily: FONTS.medium, color: COLORS.textPrimary },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: SPACE.lg },

  listCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  busyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(76, 29, 149, 0.25)',
  },
  busyCard: {
    alignItems: 'center',
    gap: SPACE.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACE.xxl,
    paddingVertical: SPACE.xl,
  },
  busyText: { fontSize: TYPE.sm, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary },
});