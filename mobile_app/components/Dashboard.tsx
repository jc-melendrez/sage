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
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '@/config/api';
import { getCurrentUser, getToken } from '@/services/authService';
import LessonDisplay from './LessonDisplay';
import LessonGenerator from './LessonGenerator';

// 🎨 Rich Purple Palette with Contrasting Shades
const COLORS = {
  bg: '#baaeda',
  bgSecondary: '#dad6e7',
  surface: '#cdc2dd',
  surfaceLight: '#5A4F6C',
  
  purpleDeep: '#4C1D95',
  purpleDark: '#6D28D9',
  purplePrimary: '#7C3AED',
  purpleVibrant: '#8B5CF6',
  purpleLight: '#A78BFA',
  purplePale: '#C4B5FD',
  purpleGhost: '#DDD6FE',
  
  accent: '#22D3EE',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  
  textPrimary: '#3a107a',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  border: 'rgba(44, 29, 0, 0.15)',
};

// 🔠 Typography System
const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
};

interface User { id: number; name?: string; first_name?: string; username?: string; streak?: number; level?: number; total_points?: number; }
interface Badge { id: number; icon_url?: string; icon?: string; name: string; }
interface Recommendation { id: number; title: string; description: string; }
interface Session { id: number; title: string; description: string; participants: number; }
interface Activity { id: number; title: string; description: string; activity_type: string; }

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

  useEffect(() => { fetchUserData(); }, []);

  const fetchUserData = async () => {
    try {
      setLoading(true);
      setError(null);
      const userProfile = await getCurrentUser();
      if (!userProfile || !userProfile.id) {
        setError("Session expired. Please log in again.");
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

  if (loading) return (<View style={styles.loadingContainer}><ActivityIndicator size="large" color={COLORS.purpleVibrant} /></View>);
  if (error) return (<View style={styles.loadingContainer}><Ionicons name="alert-circle-outline" size={48} color={COLORS.danger} /><Text style={styles.errorText}>{error}</Text></View>);

  const displayName = user?.first_name || user?.name || user?.username || 'User';
  const streakCount = user?.streak || 0;

  const handleLessonGenerated = (generatedLesson: any) => { setLesson(generatedLesson); setShowLessonGenerator(false); };
  const handleLessonDisplayClose = () => { setLesson(null); };

  const fabMenuItem1 = (
    <Animated.View style={[styles.fabMenuItemWrapper, item1Anim]}>
      <TouchableOpacity style={styles.fabMenuItem} onPress={() => { toggleFab(); onGenerateQuiz?.(); }}>
        <Text style={styles.fabMenuText}>Generate Quiz</Text>
        <View style={styles.fabMenuIconBox}><Ionicons name="document-text" size={20} color={COLORS.purpleVibrant} /></View>
      </TouchableOpacity>
    </Animated.View>
  );

  if (showLessonGenerator) return (<LessonGenerator onLessonGenerated={handleLessonGenerated} onCancel={() => setShowLessonGenerator(false)} />);
  if (lesson) return (<LessonDisplay lesson={lesson} onClose={handleLessonDisplayClose} />);

  return (
    <LinearGradient
      colors={[COLORS.bgSecondary, COLORS.bg]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.mainWrapper}
    >
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>

        {/* 🌟 HEADER with Gradient */}
        <LinearGradient
          colors={[COLORS.purpleDeep, COLORS.purpleDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <View style={styles.headerTop}>
            <View style={styles.logoContainer}>
              <Text style={styles.logoText}>SAGE</Text>
              <View style={styles.logoDot} />
            </View>
            <View style={styles.headerIcons}>
              <TouchableOpacity
                style={styles.headerIconBtn}
                activeOpacity={0.7}
                onPress={() => console.log('Notifications pressed')}
              >
                <Ionicons name="notifications-outline" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
        </LinearGradient>

        {/* 🔥 DAY STREAK - Compact Horizontal Card */}
        <View style={styles.streakSection}>
          <LinearGradient
            colors={['#4C1D95', '#6D28D9', '#7C3AED']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.streakCard}
          >
            <View style={styles.streakLeft}>
              <View style={styles.streakIconContainer}>
                <Ionicons name="flame" size={28} color="white" />
              </View>
            </View>
            
            <View style={styles.streakContent}>
              <View style={styles.streakHeader}>
                <Text style={styles.streakLabel}>Day Streak</Text>
                <View style={styles.streakBadge}>
                  <Ionicons name="flash" size={10} color="#FBBF24" />
                  <Text style={styles.streakBadgeText}>Active</Text>
                </View>
              </View>
              <Text style={styles.streakValue}>{streakCount}</Text>
              <Text style={styles.streakSubtext}>
                {streakCount > 0 ? 'Keep the fire burning! 🔥' : 'Start your journey today!'}
              </Text>
            </View>
          </LinearGradient>
        </View>

        {/* 🌟 STATS CARDS - Points & Level (Compact) */}
        <View style={styles.statsContainer}>
          <LinearGradient
            colors={[COLORS.purplePrimary, COLORS.purpleVibrant]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.statCard}
          >
            <View style={styles.statIconContainer}>
              <Ionicons name="trophy" size={20} color="white" />
            </View>
            <Text style={styles.statValue}>{user?.total_points || badges.length * 100 || 0}</Text>
            <Text style={styles.statLabel}>Points</Text>
          </LinearGradient>

          <LinearGradient
            colors={[COLORS.purpleVibrant, COLORS.purpleLight]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.statCard}
          >
            <View style={styles.statIconContainer}>
              <Ionicons name="trending-up" size={20} color="white" />
            </View>
            <Text style={styles.statValue}>Lv {user?.level || 1}</Text>
            <Text style={styles.statLabel}>Level</Text>
          </LinearGradient>
        </View>

        {/*  ACTIVE SESSIONS */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleContainer}>
              <LinearGradient
                colors={[COLORS.warning, '#FBBF24']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.sectionIconBox}
              >
                <Ionicons name="flame" size={18} color="white" />
              </LinearGradient>
              <Text style={styles.sectionTitle}>Active</Text>
            </View>
            <TouchableOpacity><Text style={styles.viewAllText}>View all</Text></TouchableOpacity>
          </View>

          {sessions.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              {sessions.slice(0, 4).map((session) => (
                <TouchableOpacity key={session.id} style={styles.sessionCard} activeOpacity={0.7}>
                  <View style={styles.sessionCardHeader}>
                    <Text style={styles.sessionTitle} numberOfLines={1}>{session.title}</Text>
                    <View style={styles.liveBadge}>
                      <View style={styles.liveDot} />
                      <Text style={styles.liveText}>LIVE</Text>
                    </View>
                  </View>
                  <Text style={styles.sessionDesc} numberOfLines={2}>{session.description}</Text>
                  <View style={styles.sessionFooter}>
                    <Ionicons name="people" size={14} color={COLORS.textMuted} />
                    <Text style={styles.sessionFooterText}>{session.participants} joined</Text>
                    <LinearGradient
                      colors={[COLORS.purplePrimary, COLORS.purpleVibrant]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.joinButton}
                    >
                      <Text style={styles.joinButtonText}>Join</Text>
                    </LinearGradient>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.emptyStateCard}>
              <View style={styles.emptyStateIconContainer}>
                <Ionicons name="school-outline" size={48} color={COLORS.purpleVibrant} />
              </View>
              <Text style={styles.emptyStateTitle}>No active sessions</Text>
              <Text style={styles.emptyStateText}>Games in progress will appear here</Text>
            </View>
          )}
        </View>

        {/* 🌟 FOR YOU - RECOMMENDATIONS */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleContainer}>
              <LinearGradient
                colors={[COLORS.purpleVibrant, COLORS.purpleLight]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.sectionIconBox}
              >
                <Ionicons name="sparkles" size={18} color="white" />
              </LinearGradient>
              <Text style={styles.sectionTitle}>For You</Text>
            </View>
            <TouchableOpacity><Text style={styles.viewAllText}>View all</Text></TouchableOpacity>
          </View>

          {recommendations.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              {recommendations.slice(0, 4).map((rec, index) => {
                const gradients = [
                  [COLORS.purpleDeep, COLORS.purplePrimary],
                  [COLORS.danger, '#F87171'],
                  [COLORS.success, '#34D399'],
                  [COLORS.purpleVibrant, COLORS.purpleLight]
                ];
                return (
                  <TouchableOpacity key={rec.id} activeOpacity={0.7}>
                    <LinearGradient
                      colors={gradients[index % gradients.length]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.recommendationCard}
                    >
                      <Text style={styles.recommendationTitle} numberOfLines={2}>{rec.title}</Text>
                      <Text style={styles.recommendationDesc} numberOfLines={3}>{rec.description}</Text>
                      <Text style={styles.recommendationCTA}>Start learning →</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : (
            <View style={styles.emptyStateCard}>
              <View style={styles.emptyStateIconContainer}>
                <Ionicons name="bulb-outline" size={48} color={COLORS.purpleVibrant} />
              </View>
              <Text style={styles.emptyStateTitle}>No recommendations yet</Text>
              <Text style={styles.emptyStateText}>Complete more lessons to get personalized suggestions</Text>
            </View>
          )}
        </View>

        {/* 🌟 RECENT ACTIVITY */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleContainer}>
              <View style={[styles.sectionIconBox, { backgroundColor: 'rgba(156, 163, 175, 0.2)' }]}>
                <Ionicons name="time" size={18} color={COLORS.textSecondary} />
              </View>
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
            <View style={styles.emptyStateCard}>
              <View style={styles.emptyStateIconContainer}>
                <Ionicons name="analytics-outline" size={48} color={COLORS.textMuted} />
              </View>
              <Text style={styles.emptyStateTitle}>No activity yet</Text>
              <Text style={styles.emptyStateText}>Your recent activities will appear here</Text>
            </View>
          )}
        </View>

        {/* 🌟 BADGES */}
        {badges.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleContainer}>
                <LinearGradient
                  colors={[COLORS.warning, '#FBBF24']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.sectionIconBox}
                >
                  <Ionicons name="ribbon" size={18} color="white" />
                </LinearGradient>
                <Text style={styles.sectionTitle}>Badges</Text>
              </View>
              <TouchableOpacity><Text style={styles.viewAllText}>View all</Text></TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.badgeScroll}>
              {badges.slice(0, 6).map((badge) => (
                <View key={badge.id} style={styles.badgeItem}>
                  <LinearGradient
                    colors={[COLORS.purpleDark, COLORS.purpleVibrant]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.badgeCircle}
                  >
                    <Text style={styles.badgeEmoji}>{badge.icon || badge.icon_url || '🏆'}</Text>
                  </LinearGradient>
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
            <TouchableOpacity style={styles.fabMenuItem} activeOpacity={0.8}>
              <Text style={styles.fabMenuText}>Create Group</Text>
              <View style={styles.fabMenuIconBox}><Ionicons name="people" size={20} color={COLORS.purpleVibrant} /></View>
            </TouchableOpacity>
          </Animated.View>
          <Animated.View style={[styles.fabMenuItemWrapper, item3Anim]}>
            <TouchableOpacity style={styles.fabMenuItem} activeOpacity={0.8}>
              <Text style={styles.fabMenuText}>Study Plan</Text>
              <View style={styles.fabMenuIconBox}><Ionicons name="calendar" size={20} color={COLORS.purpleVibrant} /></View>
            </TouchableOpacity>
          </Animated.View>
        </View>
      )}

      {/* Main FAB with Gradient */}
      <LinearGradient
        colors={isFabOpen ? [COLORS.danger, '#F87171'] : [COLORS.purpleDeep, COLORS.purpleVibrant]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.fabMain}
      >
        <TouchableOpacity onPress={toggleFab} activeOpacity={0.85}>
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <Ionicons name={isFabOpen ? "remove" : "add"} size={32} color="white" />
          </Animated.View>
        </TouchableOpacity>
      </LinearGradient>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  mainWrapper: { flex: 1 },
  loadingContainer: { flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' },
  errorText: { marginTop: 16, color: COLORS.danger, fontSize: 15, textAlign: 'center', fontFamily: FONTS.medium },
  container: { flex: 1 },

  // Header
  header: {
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 32,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 0,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoText: {
    color: 'white',
    fontSize: 32,
    fontFamily: FONTS.black,
    fontWeight: '900',
    letterSpacing: -2,
  },
  logoDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.success,
    marginLeft: 4,
    marginTop: 8,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Streak Card – Compact
  streakSection: {
    paddingHorizontal: 24,
    marginBottom: 16,
    marginTop: 12,
  },
  streakCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    padding: 16,
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  streakLeft: {
    marginRight: 16,
  },
  streakIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  streakContent: {
    flex: 1,
  },
  streakHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
    gap: 6,
  },
  streakLabel: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 12,
    fontFamily: FONTS.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 3,
  },
  streakBadgeText: {
    color: '#FBBF24',
    fontSize: 9,
    fontFamily: FONTS.bold,
    letterSpacing: 0.3,
  },
  streakValue: {
    color: 'white',
    fontSize: 32,
    fontFamily: FONTS.black,
    letterSpacing: -1.5,
    lineHeight: 38,
    marginBottom: 1,
  },
  streakSubtext: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    fontFamily: FONTS.medium,
  },

  // Stats Cards – Compact
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    marginBottom: 24,
    gap: 10,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  statIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  statValue: {
    color: 'white',
    fontSize: 22,
    fontFamily: FONTS.black,
    marginBottom: 2,
    letterSpacing: -0.5,
  },
  statLabel: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 11,
    fontFamily: FONTS.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  // Sections (unchanged)
  section: {
    paddingHorizontal: 24,
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionIconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontFamily: FONTS.extraBold,
    fontWeight: '900',
    letterSpacing: 1,
  },
  viewAllText: {
    color: COLORS.purpleDeep,
    fontSize: 14,
    fontFamily: FONTS.extraBold,
    fontWeight: '500',
  },
  scrollContent: {
    paddingRight: 24,
  },

  // Empty State (unchanged)
  emptyStateCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 40,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  emptyStateIconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.bgSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyStateTitle: {
    color: COLORS.purpleDark,
    fontSize: 16,
    fontFamily: FONTS.bold,
    marginBottom: 6,
  },
  emptyStateText: {
    color: COLORS.purpleLight,
    fontSize: 14,
    fontFamily: FONTS.regular,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Session Cards (unchanged)
  sessionCard: {
    width: 260,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    marginRight: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sessionCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sessionTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontFamily: FONTS.bold,
    flex: 1,
    marginRight: 8,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.danger,
    marginRight: 5,
  },
  liveText: {
    color: COLORS.danger,
    fontSize: 10,
    fontFamily: FONTS.black,
    letterSpacing: 0.5,
  },
  sessionDesc: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: FONTS.regular,
    marginBottom: 14,
  },
  sessionFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  sessionFooterText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontFamily: FONTS.regular,
    flex: 1,
    marginLeft: 6,
  },
  joinButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
  },
  joinButtonText: {
    color: 'white',
    fontSize: 12,
    fontFamily: FONTS.semiBold,
  },

  // Recommendation Cards (unchanged)
  recommendationCard: {
    width: 240,
    borderRadius: 20,
    padding: 20,
    marginRight: 12,
  },
  recommendationTitle: {
    color: 'white',
    fontSize: 16,
    fontFamily: FONTS.bold,
    marginBottom: 8,
  },
  recommendationDesc: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 13,
    lineHeight: 19,
    fontFamily: FONTS.regular,
    marginBottom: 14,
  },
  recommendationCTA: {
    color: 'white',
    fontSize: 13,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
  },

  // Activity (unchanged)
  activityList: {},
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 14,
  },
  activityIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityContent: {
    flex: 1,
  },
  activityTitle: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontFamily: FONTS.semiBold,
    marginBottom: 3,
  },
  activityDesc: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontFamily: FONTS.regular,
  },

  // Badges (unchanged)
  badgeScroll: {
    gap: 16,
    paddingRight: 24,
  },
  badgeItem: {
    alignItems: 'center',
    width: 76,
    marginRight: 12,
  },
  badgeCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  badgeEmoji: {
    fontSize: 32,
  },
  badgeName: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontFamily: FONTS.semiBold,
    textAlign: 'center',
  },

  // FAB (unchanged)
  fabMain: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
  },
  fabMenu: {
    position: 'absolute',
    bottom: 100,
    right: 20,
    alignItems: 'flex-end',
  },
  fabMenuItemWrapper: {
    marginBottom: 16,
  },
  fabMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fabMenuText: {
    backgroundColor: COLORS.surface,
    color: COLORS.textPrimary,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 14,
    fontSize: 14,
    marginRight: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    fontFamily: FONTS.semiBold,
  },
  fabMenuIconBox: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.bgSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
});