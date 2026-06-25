import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '@/config/api';
import { getCurrentUser, getToken } from '@/services/authService';
import LessonDisplay from './LessonDisplay';
import LessonGenerator from './LessonGenerator';

// 🎨 Modern Dark Theme
const COLORS = {
  bg: '#0A0A0F',
  bgCard: '#15151E',
  surface: '#1E1E2E',
  primary: '#6366F1',
  accent: '#22D3EE',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  textPrimary: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  border: '#272735',
  dashedBorder: '#3F3F50',
};

// 🔠 FULL MONTESERAT HIERARCHY – 7 distinct weights (Light → Black)
const FONTS = {
  display: 'Montserrat-Black',        // Big stats (Streak, Points, Level)
  heading: 'Montserrat-ExtraBold',    // User name
  subheading: 'Montserrat-Bold',      // Section headers (Active, For You)
  cardTitle: 'Montserrat-SemiBold',   // Session/Recommendation titles
  button: 'Montserrat-SemiBold',      // Actionable text (Join, View all)
  bodyMedium: 'Montserrat-Medium',    // Activity titles, emphasized body
  body: 'Montserrat-Regular',         // Descriptions, paragraphs
  caption: 'Montserrat-Light',        // Helper labels (greeting, "Day streak")
};

interface User { id: number; name?: string; first_name?: string; username?: string; streak?: number; level?: number; total_points?: number; }
interface Badge { id: number; icon_url?: string; icon?: string; name: string; }
interface Recommendation { id: number; title: string; description: string; }
interface Session { id: number; title: string; description: string; participants: number; }
interface Activity { id: number; title: string; description: string; activity_type: string; }

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function Dashboard({ onGenerateQuiz }: { onGenerateQuiz?: () => void }) {
  const [user, setUser] = useState<User | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const [lesson, setLesson] = useState<any>(null);
  const [showLessonGenerator, setShowLessonGenerator] = useState(false);

  const [isFabOpen, setIsFabOpen] = useState(false);
  const fabAnim = useRef(new Animated.Value(0)).current;

  const todayIndex = new Date().getDay();

  useEffect(() => { fetchUserData(); }, []);

  const fetchUserData = async () => {
    try {
      setLoading(true);
      setError(null);
      const userProfile = await getCurrentUser();
      if (!userProfile || !userProfile.id) {
        setError("Session expired or user not found. Please log out and log back in.");
        setLoading(false);
        return;
      }
      setUser(userProfile);
      const realUserId = userProfile.id;
      const token = await getToken();
      const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

      if (userProfile.badges) { setBadges(userProfile.badges); }
      else {
        const badgesRes = await fetch(`${API_BASE_URL}/users/${realUserId}/badges/`, { headers: authHeaders });
        if (badgesRes.ok) setBadges(await badgesRes.json());
      }

      const recsRes = await fetch(`${API_BASE_URL}/users/${realUserId}/recommendations/`, { headers: authHeaders });
      if (recsRes.ok) setRecommendations(await recsRes.json());
      const sessionsRes = await fetch(`${API_BASE_URL}/users/${realUserId}/sessions/`, { headers: authHeaders });
      if (sessionsRes.ok) setSessions(await sessionsRes.json());
      const activitiesRes = await fetch(`${API_BASE_URL}/users/${realUserId}/activities/`, { headers: authHeaders });
      if (activitiesRes.ok) setActivities(await activitiesRes.json());

      setLoading(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred';
      console.error('Error fetching data:', errorMessage);
      setError(errorMessage);
      setLoading(false);
    }
  };

  const toggleFab = () => {
    if (isFabOpen) {
      Animated.timing(fabAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setIsFabOpen(false));
    } else {
      setIsFabOpen(true);
      requestAnimationFrame(() => {
        Animated.spring(fabAnim, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
      });
    }
  };

  const spin = fabAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const item1Anim = { opacity: fabAnim, transform: [{ translateY: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [45, 0] }) }, { scale: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] };
  const item2Anim = { opacity: fabAnim, transform: [{ translateY: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) }, { scale: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] };
  const item3Anim = { opacity: fabAnim, transform: [{ translateY: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [15, 0] }) }, { scale: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] };

  if (loading) return (<View style={styles.loadingContainer}><ActivityIndicator size="large" color={COLORS.primary} /></View>);
  if (error) return (<View style={styles.loadingContainer}><Ionicons name="alert-circle-outline" size={48} color={COLORS.danger} /><Text style={styles.errorText}>{error}</Text></View>);

  const displayName = user?.first_name || user?.name || user?.username || 'User';
  const streakCount = user?.streak || 0;

  const handleLessonGenerated = (generatedLesson: any) => { setLesson(generatedLesson); setShowLessonGenerator(false); };
  const handleLessonDisplayClose = () => { setLesson(null); };

  const fabMenuItem1 = (
    <Animated.View style={[styles.fabMenuItemWrapper, item1Anim]}>
      <TouchableOpacity style={styles.fabMenuItem} onPress={() => { toggleFab(); onGenerateQuiz?.(); }}>
        <Text style={styles.fabMenuText}>Generate Quiz</Text>
        <View style={styles.fabMenuIconBox}><Ionicons name="document-text" size={20} color={COLORS.primary} /></View>
      </TouchableOpacity>
    </Animated.View>
  );

  if (showLessonGenerator) return (<LessonGenerator onLessonGenerated={handleLessonGenerated} onCancel={() => setShowLessonGenerator(false)} />);
  if (lesson) return (<LessonDisplay lesson={lesson} onClose={handleLessonDisplayClose} />);

  return (
    <View style={styles.mainWrapper}>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>

        {/* 🌟 1. HEADER */}
        <View style={styles.topHeader}>
          <View style={styles.headerContent}>
            <Text style={styles.greetingText}>Good evening</Text>
            <Text style={styles.userNameText}>{displayName}</Text>
          </View>
          <TouchableOpacity style={styles.settingsBtn}>
            <Ionicons name="settings-outline" size={24} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* 🌟 2. STATS ROW */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <View style={styles.statIconBox}>
              <Ionicons name="flame" size={20} color={COLORS.warning} />
            </View>
            <Text style={styles.statValue}>{streakCount}</Text>
            <Text style={styles.statLabel}>Day streak</Text>
          </View>

          <View style={styles.statBox}>
            <View style={styles.statIconBox}>
              <Ionicons name="trophy" size={20} color={COLORS.accent} />
            </View>
            <Text style={styles.statValue}>{user?.total_points || badges.length * 100 || 0}</Text>
            <Text style={styles.statLabel}>Points</Text>
          </View>

          <View style={styles.statBox}>
            <View style={styles.statIconBox}>
              <Ionicons name="trending-up" size={20} color={COLORS.success} />
            </View>
            <Text style={styles.statValue}>Lv {user?.level || 1}</Text>
            <Text style={styles.statLabel}>Level</Text>
          </View>
        </View>

        {/* 🌟 3. ACTIVE SESSIONS */}
        <View style={styles.contentSection}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="flame" size={20} color={COLORS.warning} />
              <Text style={styles.sectionTitle}>Active</Text>
            </View>
            <TouchableOpacity><Text style={styles.viewAllText}>View all</Text></TouchableOpacity>
          </View>

          {sessions.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sessionScroll}>
              {sessions.slice(0, 4).map((session) => (
                <TouchableOpacity key={session.id} style={styles.sessionCardFilled}>
                  <View style={styles.sessionCardHeader}>
                    <Text style={styles.sessionCardTitle} numberOfLines={1}>{session.title}</Text>
                    <View style={styles.livePill}>
                      <View style={styles.liveDot} />
                      <Text style={styles.liveText}>LIVE</Text>
                    </View>
                  </View>
                  <Text style={styles.sessionCardDesc} numberOfLines={2}>{session.description}</Text>
                  <View style={styles.sessionCardFooter}>
                    <Ionicons name="person" size={14} color={COLORS.textSecondary} />
                    <Text style={styles.sessionCardFooterText}>{session.participants} joined</Text>
                    <TouchableOpacity style={styles.joinBtnSmall}>
                      <Text style={styles.joinBtnSmallText}>Join</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.dashedEmptyCard}>
              <View style={styles.emptyIllustration}>
                <Ionicons name="school-outline" size={56} color={COLORS.warning} />
              </View>
              <Text style={styles.emptyCardText}>Games in progress will appear here</Text>
            </View>
          )}
        </View>

        {/* 🌟 4. AI RECOMMENDATIONS */}
        <View style={styles.contentSection}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="sparkles" size={20} color={COLORS.accent} />
              <Text style={styles.sectionTitle}>For You</Text>
            </View>
            <TouchableOpacity><Text style={styles.viewAllText}>View all</Text></TouchableOpacity>
          </View>

          {recommendations.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sessionScroll}>
              {recommendations.slice(0, 4).map((rec, index) => {
                const cardColors = [COLORS.primary, COLORS.danger, COLORS.success, COLORS.accent];
                return (
                  <TouchableOpacity key={rec.id} style={[styles.recommendationCard, { borderLeftColor: cardColors[index % cardColors.length] }]}>
                    <Text style={styles.recommendationTitle} numberOfLines={2}>{rec.title}</Text>
                    <Text style={styles.recommendationDesc} numberOfLines={3}>{rec.description}</Text>
                    <Text style={styles.recommendationAction}>Start learning →</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : (
            <View style={styles.dashedEmptyCard}>
              <View style={styles.emptyIllustration}>
                <Ionicons name="bulb-outline" size={56} color={COLORS.accent} />
              </View>
              <Text style={styles.emptyCardText}>Complete more lessons to get personalized AI suggestions</Text>
            </View>
          )}
        </View>

        {/* 🌟 5. RECENT ACTIVITIES */}
        <View style={styles.contentSection}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="time" size={20} color={COLORS.textSecondary} />
              <Text style={styles.sectionTitle}>Recent Activity</Text>
            </View>
            <TouchableOpacity><Text style={styles.viewAllText}>View all</Text></TouchableOpacity>
          </View>

          {activities.length > 0 ? (
            <View style={styles.activityList}>
              {activities.slice(0, 4).map((activity) => (
                <View key={activity.id} style={styles.activityItem}>
                  <View style={styles.activityIconBox}>
                    <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
                  </View>
                  <View style={styles.activityContent}>
                    <Text style={styles.activityTitle}>{activity.title}</Text>
                    <Text style={styles.activityDesc} numberOfLines={1}>{activity.description}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.dashedEmptyCard}>
              <View style={styles.emptyIllustration}>
                <Ionicons name="analytics-outline" size={56} color={COLORS.textMuted} />
              </View>
              <Text style={styles.emptyCardText}>Your activity will appear here</Text>
            </View>
          )}
        </View>

        {/* 🌟 6. BADGES */}
        {badges.length > 0 && (
          <View style={styles.contentSection}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderLeft}>
                <Ionicons name="ribbon" size={20} color={COLORS.warning} />
                <Text style={styles.sectionTitle}>Badges</Text>
              </View>
              <TouchableOpacity><Text style={styles.viewAllText}>View all</Text></TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.badgeScroll}>
              {badges.slice(0, 6).map((badge) => (
                <View key={badge.id} style={styles.badgeItem}>
                  <View style={styles.badgeCircle}>
                    <Text style={styles.badgeEmoji}>{badge.icon || badge.icon_url || '🏆'}</Text>
                  </View>
                  <Text style={styles.badgeName} numberOfLines={1}>{badge.name}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

      </ScrollView>

      {/* FAB Menu */}
      {isFabOpen && (
        <View style={styles.fabMenu}>
          {fabMenuItem1}
          <Animated.View style={[styles.fabMenuItemWrapper, item2Anim]}>
            <TouchableOpacity style={styles.fabMenuItem}>
              <Text style={styles.fabMenuText}>Create Group</Text>
              <View style={styles.fabMenuIconBox}><Ionicons name="people" size={20} color={COLORS.primary} /></View>
            </TouchableOpacity>
          </Animated.View>
          <Animated.View style={[styles.fabMenuItemWrapper, item3Anim]}>
            <TouchableOpacity style={styles.fabMenuItem}>
              <Text style={styles.fabMenuText}>Study Plan</Text>
              <View style={styles.fabMenuIconBox}><Ionicons name="calendar" size={20} color={COLORS.primary} /></View>
            </TouchableOpacity>
          </Animated.View>
        </View>
      )}

      {/* Main FAB */}
      <TouchableOpacity
        style={[styles.fabMain, { backgroundColor: isFabOpen ? COLORS.danger : COLORS.primary }]}
        onPress={toggleFab}
        activeOpacity={0.8}
      >
        <Animated.View style={{ transform: [{ rotate: spin }] }}>
          <Ionicons name={isFabOpen ? "remove" : "add"} size={32} color="white" />
        </Animated.View>
      </TouchableOpacity>

    </View>
  );
}

const styles = StyleSheet.create({
  mainWrapper: { flex: 1, backgroundColor: COLORS.bg },
  loadingContainer: { flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' },
  errorText: { marginTop: 10, color: COLORS.danger, fontSize: 16, textAlign: 'center', fontFamily: FONTS.body },
  container: { flex: 1 },

  // 1. HEADER
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 16,
  },
  headerContent: { flex: 1 },
  greetingText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontFamily: FONTS.caption, // Montserrat-Light
    marginBottom: 2,
  },
  userNameText: {
    color: COLORS.textPrimary,
    fontSize: 22,
    fontFamily: FONTS.heading, // Montserrat-ExtraBold
    letterSpacing: -0.5,
  },
  settingsBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.surface,
    justifyContent: 'center', alignItems: 'center',
  },

  // 2. STATS ROW
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 20,
    gap: 12,
  },
  statBox: {
    flex: 1,
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statIconBox: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surface,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 6,
  },
  statValue: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontFamily: FONTS.display, // Montserrat-Black (heaviest)
    marginBottom: 2,
  },
  statLabel: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontFamily: FONTS.caption, // Montserrat-Light (lightest)
    letterSpacing: 0.3,
  },

  // CONTENT SECTIONS
  contentSection: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontFamily: FONTS.subheading, // Montserrat-Bold
  },
  viewAllText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontFamily: FONTS.button, // Montserrat-SemiBold
  },

  // DASHED EMPTY CARD
  dashedEmptyCard: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.dashedBorder,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    backgroundColor: COLORS.bgCard,
  },
  emptyIllustration: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: COLORS.surface,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 12,
  },
  emptyCardText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    fontFamily: FONTS.body, // Montserrat-Regular
    lineHeight: 18,
  },

  // SESSION CARDS
  sessionScroll: { gap: 12 },
  sessionCardFilled: {
    width: 220,
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 12,
  },
  sessionCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  sessionCardTitle: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontFamily: FONTS.cardTitle, // Montserrat-SemiBold
    flex: 1,
    marginRight: 6,
  },
  livePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(239, 68, 68, 0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  liveDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: COLORS.danger, marginRight: 3 },
  liveText: {
    color: COLORS.danger,
    fontSize: 9,
    fontFamily: FONTS.button, // Montserrat-SemiBold
    letterSpacing: 0.5,
  },
  sessionCardDesc: {
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONTS.body, // Montserrat-Regular
    marginBottom: 10,
  },
  sessionCardFooter: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 8 },
  sessionCardFooterText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontFamily: FONTS.caption, // Montserrat-Light
    flex: 1,
    marginLeft: 4,
  },
  joinBtnSmall: { backgroundColor: COLORS.primary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  joinBtnSmallText: {
    color: 'white',
    fontSize: 11,
    fontFamily: FONTS.button, // Montserrat-SemiBold
  },

  // RECOMMENDATION CARDS
  recommendationCard: {
    width: 200,
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderLeftWidth: 4,
    marginRight: 12,
  },
  recommendationTitle: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontFamily: FONTS.cardTitle, // Montserrat-SemiBold
    marginBottom: 4,
  },
  recommendationDesc: {
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONTS.body, // Montserrat-Regular
    marginBottom: 10,
  },
  recommendationAction: {
    color: COLORS.accent,
    fontSize: 12,
    fontFamily: FONTS.button, // Montserrat-SemiBold
  },

  // ACTIVITY LIST
  activityList: {},
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 10,
  },
  activityIconBox: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
  activityContent: { flex: 1 },
  activityTitle: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontFamily: FONTS.bodyMedium, // Montserrat-Medium (distinct from regular body)
    marginBottom: 1,
  },
  activityDesc: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontFamily: FONTS.body, // Montserrat-Regular
  },

  // BADGES
  badgeScroll: { gap: 12 },
  badgeItem: { alignItems: 'center', width: 64, marginRight: 12 },
  badgeCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 4,
  },
  badgeEmoji: { fontSize: 24 },
  badgeName: {
    color: COLORS.textSecondary,
    fontSize: 10,
    textAlign: 'center',
    fontFamily: FONTS.bodyMedium, // Montserrat-Medium
  },

  // FAB
  fabMain: {
    position: 'absolute', bottom: 24, right: 20, width: 60, height: 60, borderRadius: 30,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 8,
  },
  fabMenu: { position: 'absolute', bottom: 96, right: 20, alignItems: 'flex-end' },
  fabMenuItemWrapper: { marginBottom: 12 },
  fabMenuItem: { flexDirection: 'row', alignItems: 'center' },
  fabMenuText: {
    backgroundColor: COLORS.bgCard, color: COLORS.textPrimary, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, fontSize: 13, marginRight: 12,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 4,
    fontFamily: FONTS.button, // Montserrat-SemiBold
  },
  fabMenuIconBox: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 4,
  },
});