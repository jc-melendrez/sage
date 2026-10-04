import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, RefreshControl, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, FilterChip, EmptyState, Pill } from '@/components/educator/EducatorPrimitives';
import { KeyboardSafeView } from '@/components/KeyboardSafeView';
import { getMyCourses } from '@/services/courseService';
import {
  getAnnouncements,
  createAnnouncement,
  formatAnnouncementTime,
  formatAudience,
  isPending,
  Announcement,
} from '@/services/announcementService';

interface CourseOption {
  id: number;
  name: string;
  student_count: number;
}

/** 'all' targets every class the educator owns; 'custom' targets a picked subset. */
type AudienceMode = 'all' | 'custom';

/** Quick presets cover the common "tell them tonight/tomorrow" case without
 *  making everyone reach for the wheel picker. */
type SchedulePreset = 'tomorrow9' | 'tomorrow16' | 'nextweek9' | 'custom';

const PRESET_LABELS: [SchedulePreset, string][] = [
  ['tomorrow9', 'Tomorrow 9am'],
  ['tomorrow16', 'Tomorrow 4pm'],
  ['nextweek9', 'Next week 9am'],
  ['custom', 'Pick a time…'],
];

function atHour(base: Date, dayOffset: number, hour: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export default function AnnouncementsScreen() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Compose state
  const [message, setMessage] = useState('');
  const [audienceMode, setAudienceMode] = useState<AudienceMode>('all');
  const [selectedCourseIds, setSelectedCourseIds] = useState<number[]>([]);
  const [preset, setPreset] = useState<SchedulePreset | null>(null);
  const [customAt, setCustomAt] = useState<Date | null>(null);
  const [sending, setSending] = useState(false);

  // Picker state
  const [showPicker, setShowPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');
  const [pickedDate, setPickedDate] = useState<Date>(new Date());

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      const data = await getAnnouncements();
      setAnnouncements(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load announcements.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Re-read on every visit: the bell is an inbox, so returning to the screen
  // after posting from elsewhere must not show the previous list.
  useFocusEffect(
    useCallback(() => {
      load();
      (async () => {
        try {
          const mine = await getMyCourses();
          setCourses(mine.map((c) => ({ id: c.id, name: c.name, student_count: c.student_count })));
        } catch {
          setCourses([]);
        }
      })();
    }, [load]),
  );

  const toggleCourse = (id: number) => {
    setAudienceMode('custom');
    setSelectedCourseIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const resolvedCourseIds = useMemo(
    () => (audienceMode === 'all' ? courses.map((c) => c.id) : selectedCourseIds),
    [audienceMode, courses, selectedCourseIds]
  );

  /**
   * Pre-send preview of how many students this reaches, summed per class.
   *
   * Classes can share a student, so with more than one class selected this
   * over-counts; the exact, de-duplicated count only exists server-side once
   * the announcement exists. The preview therefore marks it as approximate and
   * the confirmation uses the count the server returns.
   */
  const recipientTotal = useMemo(() => {
    if (resolvedCourseIds.length === 0) return 0;
    const chosen = courses.filter((c) => resolvedCourseIds.includes(c.id));
    return chosen.reduce((sum, c) => sum + (c.student_count ?? 0), 0);
  }, [courses, resolvedCourseIds]);

  const recipientSummary = useMemo(() => {
    if (resolvedCourseIds.length === 0) return 'No classes selected';
    const classWord = `class${resolvedCourseIds.length === 1 ? '' : 'es'}`;
    const studentWord = `student${recipientTotal === 1 ? '' : 's'}`;
    const approx = resolvedCourseIds.length > 1 ? '~' : '';
    return `${resolvedCourseIds.length} ${classWord} · ${approx}${recipientTotal} ${studentWord}`;
  }, [resolvedCourseIds.length, recipientTotal]);

  const scheduleFor = useCallback((): Date | null => {
    const now = new Date();
    if (preset === 'tomorrow9') return atHour(now, 1, 9);
    if (preset === 'tomorrow16') return atHour(now, 1, 16);
    if (preset === 'nextweek9') return atHour(now, 7, 9);
    if (preset === 'custom') return customAt;
    return null;
  }, [preset, customAt]);

  const openPicker = () => {
    setPickedDate(customAt ?? new Date());
    setPickerMode('date');
    setShowPicker(true);
  };

  const handlePickerChange = ({ nativeEvent }: any) => {
    if (nativeEvent.type === 'dismissed') {
      setShowPicker(false);
      return;
    }
    const next = nativeEvent.timestamp ? new Date(nativeEvent.timestamp) : pickedDate;
    setPickedDate(next);
    if (pickerMode === 'date') {
      setPickerMode('time');
      return;
    }
    const combined = new Date(
      pickedDate.getFullYear(), pickedDate.getMonth(), pickedDate.getDate(),
      next.getHours(), next.getMinutes()
    );
    // The API withholds a scheduled post until its moment passes, so a pick in
    // the past would be delivered (and labelled) as already sent. Bump it to
    // the next day rather than silently sending something labelled "Scheduled".
    const safe = combined.getTime() <= Date.now() ? new Date(Date.now() + 3600000) : combined;
    setCustomAt(safe);
    setPreset('custom');
    setShowPicker(false);
  };

  const resetCompose = () => {
    setMessage('');
    setAudienceMode('all');
    setSelectedCourseIds([]);
    setPreset(null);
    setCustomAt(null);
  };

  const handleSend = async () => {
    const text = message.trim();
    if (!text) {
      Alert.alert('Nothing to send', 'Write your announcement first.');
      return;
    }
    if (courses.length === 0) {
      Alert.alert('No classes yet', 'Create a class before sending an announcement.');
      return;
    }
    if (resolvedCourseIds.length === 0) {
      Alert.alert('Pick a class', 'Choose at least one class to send this to.');
      return;
    }
    const scheduledAt = scheduleFor();
    if (preset && !scheduledAt) {
      Alert.alert('Pick a time', 'Choose when this should be sent.');
      return;
    }

    setSending(true);
    try {
      const created = await createAnnouncement({
        message: text,
        course_ids: resolvedCourseIds,
        is_scheduled: Boolean(scheduledAt),
        scheduled_at: scheduledAt ? scheduledAt.toISOString() : null,
      });
      resetCompose();
      await load();
      // Use the count the server computed (rosters de-duplicated across classes)
      // rather than the pre-send sum, which over-counts shared students.
      const reached = created.recipient_count;
      const reachedText = `${reached} student${reached === 1 ? '' : 's'}`;
      Alert.alert(
        scheduledAt ? 'Scheduled' : 'Sent',
        scheduledAt
          ? `Your announcement will reach ${reachedText} at the scheduled time.`
          : `Delivered to ${reachedText}.`
      );
    } catch (err) {
      Alert.alert(
        'Could not send',
        err instanceof Error ? err.message : 'Something went wrong. Try again.'
      );
    } finally {
      setSending(false);
    }
  };

  const sorted = useMemo(
    () => [...announcements].sort((a, b) => {
      // Pending posts float to the top: the educator's next action is usually
      // the one still waiting to go out.
      const pa = isPending(a) ? 1 : 0;
      const pb = isPending(b) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
    }),
    [announcements]
  );

  const canSend = message.trim().length > 0 && resolvedCourseIds.length > 0 && !sending;

  return (
    <KeyboardSafeView style={styles.container}>
      <View style={styles.container}>
        <EducatorHeader
          title="Announcements"
          subtitle="Keep your class in the loop"
          showBack
        />

        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('refresh')}
              tintColor={COLORS.purpleVibrant}
              colors={[COLORS.purpleVibrant]}
            />
          }
        >
          <View style={styles.section}>
            <SectionHeader title="New Announcement" />
            <View style={styles.composeCard}>
              <TextInput
                style={styles.textArea}
                placeholder="Write your announcement..."
                placeholderTextColor={COLORS.textMuted}
                multiline
                value={message}
                onChangeText={setMessage}
              />

              <Text style={styles.fieldLabel}>Recipients</Text>
              {courses.length === 0 ? (
                <Text style={styles.hintText}>
                  You have no classes yet — create one to start announcing.
                </Text>
              ) : (
                <>
                  <View style={styles.chipRow}>
                    <FilterChip
                      label={`All classes (${courses.length})`}
                      active={audienceMode === 'all'}
                      onPress={() => setAudienceMode('all')}
                    />
                    <FilterChip
                      label="Selected"
                      active={audienceMode === 'custom'}
                      onPress={() => setAudienceMode('custom')}
                    />
                  </View>

                  {audienceMode === 'custom' && (
                    <View style={styles.chipRow}>
                      {courses.map((course) => (
                        <FilterChip
                          key={course.id}
                          label={course.name}
                          active={selectedCourseIds.includes(course.id)}
                          onPress={() => toggleCourse(course.id)}
                        />
                      ))}
                    </View>
                  )}

                  <Text style={styles.recipientSummary}>{recipientSummary}</Text>
                </>
              )}

              <Text style={styles.fieldLabel}>Send</Text>
              {preset && (
                <>
                  <View style={styles.chipRow}>
                    {PRESET_LABELS.map(([value, label]) => (
                      <FilterChip
                        key={value}
                        label={label}
                        active={preset === value}
                        onPress={() => {
                          if (value === 'custom') {
                            openPicker();
                          } else {
                            setPreset(value);
                            setCustomAt(null);
                          }
                        }}
                      />
                    ))}
                  </View>
                  {scheduleFor() && (
                    <View style={styles.scheduledRow}>
                      <Ionicons name="time" size={14} color={COLORS.warning} />
                      <Text style={styles.scheduledText}>
                        Goes out {scheduleFor()!.toLocaleString()}
                      </Text>
                      <TouchableOpacity
                        onPress={() => { setPreset(null); setCustomAt(null); }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              )}

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.scheduleBtn, preset && styles.scheduleBtnActive]}
                  activeOpacity={0.85}
                  onPress={() => {
                    if (preset) {
                      setPreset(null);
                      setCustomAt(null);
                    } else {
                      openPicker();
                    }
                  }}
                >
                  <Ionicons
                    name="calendar-outline"
                    size={16}
                    color={preset ? 'white' : COLORS.purplePrimary}
                  />
                  <Text style={[styles.scheduleText, preset && styles.scheduleTextActive]}>
                    {preset ? 'Scheduled' : 'Schedule'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.broadcastBtn, !canSend && styles.broadcastBtnDisabled]}
                  activeOpacity={0.85}
                  onPress={handleSend}
                  disabled={!canSend}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <>
                      <Ionicons name="megaphone" size={16} color="white" />
                      <Text style={styles.broadcastText}>
                        {preset ? 'Schedule' : 'Broadcast Now'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <SectionHeader title="Previous Announcements" />
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={COLORS.purpleVibrant} />
              </View>
            ) : loadError ? (
              <View style={styles.listCard}>
                <Text style={styles.errorText}>{loadError}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : sorted.length > 0 ? (
              <View style={styles.listCard}>
                {sorted.map((a, idx) => {
                  const pending = isPending(a);
                  return (
                    <View key={a.id} style={[styles.historyItem, idx > 0 && styles.borderTop]}>
                      <View
                        style={[
                          styles.historyIconBg,
                          { backgroundColor: tint(pending ? COLORS.warning : COLORS.purpleVibrant) },
                        ]}
                      >
                        <Ionicons
                          name={pending ? 'time' : 'megaphone'}
                          size={16}
                          color={pending ? COLORS.warning : COLORS.purpleVibrant}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.historyTitle} numberOfLines={2}>
                          {a.message}
                        </Text>
                        <View style={styles.historyMetaRow}>
                          <Text style={styles.historyMeta} numberOfLines={1}>
                            {formatAudience(a)} · {formatAnnouncementTime(a)}
                          </Text>
                        </View>
                        {pending && (
                          <View style={styles.pendingPill}>
                            <Pill
                              label={`${a.recipient_count} student${a.recipient_count === 1 ? '' : 's'} queued`}
                              color={COLORS.warning}
                              icon="time"
                            />
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <EmptyState
                icon="megaphone-outline"
                title="No announcements yet"
                text="Your posted updates will show up here."
              />
            )}
          </View>
        </ScrollView>

        {showPicker && (
          <DateTimePicker
            value={pickedDate}
            mode={pickerMode}
            minimumDate={new Date()}
            onChange={handlePickerChange}
            {...(Platform.OS === 'ios' ? { display: 'spinner' as const } : {})}
          />
        )}
      </View>
    </KeyboardSafeView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  section: { marginBottom: 28 },

  composeCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 18, borderWidth: 1, borderColor: COLORS.border },
  textArea: {
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  fieldLabel: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.3 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recipientSummary: { fontSize: 11.5, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 10 },
  hintText: { fontSize: 12.5, fontFamily: FONTS.regular, color: COLORS.textMuted, lineHeight: 18 },

  scheduledRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, backgroundColor: tint(COLORS.warning), paddingHorizontal: 12, paddingVertical: 9, borderRadius: RADIUS.sm },
  scheduledText: { flex: 1, fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary },

  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  scheduleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1, borderWidth: 2, borderColor: COLORS.purplePrimary, borderRadius: RADIUS.sm, paddingVertical: 12 },
  scheduleBtnActive: { backgroundColor: COLORS.purplePrimary },
  scheduleText: { color: COLORS.purplePrimary, fontSize: 13.5, fontFamily: FONTS.bold, fontWeight: '700' },
  scheduleTextActive: { color: 'white' },
  broadcastBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1.3, backgroundColor: COLORS.purplePrimary, borderRadius: RADIUS.sm, paddingVertical: 12 },
  broadcastBtnDisabled: { opacity: 0.45 },
  broadcastText: { color: 'white', fontSize: 13.5, fontFamily: FONTS.bold, fontWeight: '700' },

  loadingBox: { paddingVertical: 32, alignItems: 'center' },
  listCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, paddingHorizontal: 16, borderWidth: 1, borderColor: COLORS.border },
  errorText: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.danger, paddingVertical: 16, textAlign: 'center' },
  retryBtn: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 20 },
  retryText: { color: COLORS.purplePrimary, fontSize: 13.5, fontFamily: FONTS.bold, fontWeight: '700' },

  borderTop: { borderTopWidth: 1, borderTopColor: COLORS.border },
  historyItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14 },
  historyIconBg: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  historyTitle: { fontSize: 13.5, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 2 },
  historyMetaRow: { flexDirection: 'row', alignItems: 'center' },
  historyMeta: { fontSize: 11.5, fontFamily: FONTS.regular, color: COLORS.textMuted, flexShrink: 1 },
  pendingPill: { marginTop: 8, alignSelf: 'flex-start' },
});