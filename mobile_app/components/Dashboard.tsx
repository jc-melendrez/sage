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
  UIManager,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '@/config/api';
import { Fonts } from '@/constants/theme';
import { getCurrentUser, getToken } from '@/services/authService';
import LessonDisplay from './LessonDisplay';
import LessonGenerator from './LessonGenerator';

interface User {
  id: number;
  name?: string;
  first_name?: string;
  username?: string;
  streak?: number;
  level?: number;
  total_points?: number;
}

interface Badge {
  id: number;
  icon_url?: string;
  icon?: string;
  name: string;
}

interface Recommendation {
  id: number;
  title: string;
  description: string;
}

interface Session {
  id: number;
  title: string;
  description: string;
  participants: number;
}

interface Activity {
  id: number;
  title: string;
  description: string;
  activity_type: string;
}

export default function Dashboard({ onGenerateQuiz }: { onGenerateQuiz?: () => void }) {
  const [user, setUser] = useState<User | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Lesson State
  const [lesson, setLesson] = useState<any>(null);
  const [showLessonGenerator, setShowLessonGenerator] = useState(false);

  // FAB State & Animation Tracker
  const [isFabOpen, setIsFabOpen] = useState(false);
  const fabAnim = useRef(new Animated.Value(0)).current; 

  useEffect(() => {
    fetchUserData();
  }, []);

  const fetchUserData = async () => {
    try {
      setLoading(true);
      setError(null);

      const userProfile = await getCurrentUser();
      
      // 🌟 CRITICAL FIX: Stop execution if the user is missing or logged out
      if (!userProfile || !userProfile.id) {
        setError("Session expired or user not found. Please log out and log back in.");
        setLoading(false);
        return; 
      }

      setUser(userProfile);
      const realUserId = userProfile.id;

      const token = await getToken();
      const authHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };

      if (userProfile.badges) {
        setBadges(userProfile.badges);
      } else {
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
      Animated.timing(fabAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => setIsFabOpen(false));
    } else {
      setIsFabOpen(true);
      requestAnimationFrame(() => {
        Animated.spring(fabAnim, {
          toValue: 1,
          friction: 5,
          tension: 60,
          useNativeDriver: true,
        }).start();
      });
    }
  };

  const spin = fabAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'] 
  });

  const item1Anim = {
    opacity: fabAnim,
    transform: [
      { translateY: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [45, 0] }) },
      { scale: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }
    ]
  };

  const item2Anim = {
    opacity: fabAnim,
    transform: [
      { translateY: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) },
      { scale: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }
    ]
  };

  const item3Anim = {
    opacity: fabAnim,
    transform: [
      { translateY: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [15, 0] }) },
      { scale: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }
    ]
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#6D28D9" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.loadingContainer, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
        <Text style={{ marginTop: 10, color: '#EF4444', fontSize: 16, textAlign: 'center' }}>
          {error}
        </Text>
      </View>
    );
  }

  const displayName = user?.first_name || user?.name || user?.username || 'User';

  // Handle lesson generation
  const handleLessonGenerated = (generatedLesson: any) => {
    setLesson(generatedLesson);
    setShowLessonGenerator(false);
  };

  // Handle lesson display close
  const handleLessonDisplayClose = () => {
    setLesson(null);
  };

  // Handle FAB menu item press for lesson generation
  const handleGenerateLesson = () => {
    toggleFab();
    setShowLessonGenerator(true);
  };

  // Generate Quiz menu item
  const fabMenuItem1 = (
    <Animated.View style={[styles.fabMenuItemWrapper, item1Anim]}>
      <TouchableOpacity 
        style={styles.fabMenuItem}
        onPress={() => {
          toggleFab();
          onGenerateQuiz?.();
        }}
      >
        <Text style={styles.fabMenuText}>Generate Quiz</Text>
        <View style={styles.fabMenuIconBox}><Ionicons name="document-text" size={20} color="#6D28D9" /></View>
      </TouchableOpacity>
    </Animated.View>
  );

  // Conditionally render components
  if (showLessonGenerator) {
    return (
      <LessonGenerator
        onLessonGenerated={handleLessonGenerated}
        onCancel={() => setShowLessonGenerator(false)}
      />
    );
  }

  if (lesson) {
    return (
      <LessonDisplay
        lesson={lesson}
        onClose={handleLessonDisplayClose}
      />
    );
  }

  return (
    <View style={styles.mainWrapper}>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        
        {/* 🌟 COMBINED: Glassmorphic Figma Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View>
              <Text style={styles.welcome}>Welcome Back,</Text>
              <Text style={styles.name}>{displayName}</Text>
            </View>
            <View style={styles.iconCircle}>
              <Ionicons name="star" size={24} color="white" />
            </View>
          </View>

          <View style={styles.glassStatsRow}>
            <View style={styles.glassStatCard}>
              <View style={styles.glassStatIconRow}>
                <Ionicons name="flame" size={20} color="#F97316" />
                <Text style={styles.glassStatValue}>{user?.streak || 0}</Text>
              </View>
              <Text style={styles.glassStatLabel}>Day Streak</Text>
            </View>

            <View style={styles.glassStatCard}>
              <View style={styles.glassStatIconRow}>
                <Ionicons name="trophy" size={20} color="#FBBF24" />
                <Text style={styles.glassStatValue}>{user?.total_points || badges.length * 100 || 0}</Text>
              </View>
              <Text style={styles.glassStatLabel}>Points</Text>
            </View>

            <View style={styles.glassStatCard}>
              <View style={styles.glassStatIconRow}>
                <Ionicons name="trending-up" size={20} color="#34D399" />
                <Text style={styles.glassStatValue}>Lv {user?.level || 1}</Text>
              </View>
              <Text style={styles.glassStatLabel}>Level</Text>
            </View>
          </View>
        </View>

        <View style={styles.content}>
          {/* AI Recommendations */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="sparkles" size={20} color="#6D28D9" />
                <Text style={styles.sectionTitle}>AI Recommendations</Text>
              </View>
            </View>
            
            {recommendations.length > 0 ? (
              recommendations.slice(0, 2).map((rec, index) => (
                <View key={rec.id} style={[styles.card, styles.aiCard, index === 0 ? { borderLeftColor: '#EF4444' } : { borderLeftColor: '#F59E0B' }]}>
                  <View style={styles.aiDotRow}>
                    <View style={[styles.priorityDot, index === 0 ? { backgroundColor: '#EF4444' } : { backgroundColor: '#F59E0B' }]} />
                    <Text style={styles.cardTitle}>{rec.title}</Text>
                  </View>
                  <Text style={styles.cardDescription}>{rec.description}</Text>
                </View>
              ))
            ) : (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>No recommendations yet</Text>
                <Text style={styles.cardDescription}>Come back soon for personalized AI recommendations</Text>
              </View>
            )}
          </View>

          {/* 🌟 COMBINED: Group Sessions with JOIN button */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="people" size={20} color="#1F2937" />
                <Text style={styles.sectionTitle}>Group Sessions</Text>
              </View>
              <TouchableOpacity>
                <Text style={styles.joinButtonText}>Join</Text>
              </TouchableOpacity>
            </View>
            
            {sessions.length > 0 ? (
              sessions.slice(0, 2).map((session) => (
                <View key={session.id} style={styles.card}>
                  <View style={styles.sessionHeaderRow}>
                    <Text style={styles.cardTitle}>{session.title}</Text>
                    <View style={styles.badgePill}>
                      <Ionicons name="time-outline" size={12} color="#4B5563" />
                      <Text style={styles.badgePillText}>Active</Text>
                    </View>
                  </View>
                  <Text style={styles.cardDescription}>{session.description}</Text>
                  <View style={styles.sessionFooter}>
                    <Ionicons name="person" size={14} color="#6D28D9" />
                    <Text style={styles.sessionFooterText}>{session.participants} participants</Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>No sessions yet</Text>
                <Text style={styles.cardDescription}>Create or join a group session</Text>
              </View>
            )}
          </View>

          {/* 🌟 RESTORED: Recent Activities */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="time-outline" size={20} color="#1F2937" />
                <Text style={styles.sectionTitle}>Recent Activities</Text>
              </View>
            </View>

            {activities.length > 0 ? (
              activities.slice(0, 2).map((activity) => (
                <View key={activity.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{activity.title}</Text>
                  <Text style={styles.cardDescription}>{activity.description}</Text>
                </View>
              ))
            ) : (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>No activities yet</Text>
                <Text style={styles.cardDescription}>Your activities will appear here</Text>
              </View>
            )}
          </View>

          {/* Recent Badges */}
          {badges.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="ribbon" size={20} color="#1F2937" />
                  <Text style={styles.sectionTitle}>Recent Badges</Text>
                </View>
              </View>
              <View style={styles.badgeRow}>
                {badges.slice(0, 4).map((badge) => (
                  <View key={badge.id} style={styles.badgeCard}>
                    <Text style={styles.badgeIcon}>{badge.icon || badge.icon_url || '🏆'}</Text>
                    <Text style={styles.badgeLabel} numberOfLines={1}>{badge.name}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* FAB Sliding Menu Items */}
      {isFabOpen && (
        <View style={styles.fabMenu}>
          {fabMenuItem1}

          <Animated.View style={[styles.fabMenuItemWrapper, item2Anim]}>
            <TouchableOpacity style={styles.fabMenuItem}>
              <Text style={styles.fabMenuText}>Create Group</Text>
              <View style={styles.fabMenuIconBox}><Ionicons name="people" size={20} color="#6D28D9" /></View>
            </TouchableOpacity>
          </Animated.View>

          <Animated.View style={[styles.fabMenuItemWrapper, item3Anim]}>
            <TouchableOpacity style={styles.fabMenuItem}>
              <Text style={styles.fabMenuText}>Study Plan</Text>
              <View style={styles.fabMenuIconBox}><Ionicons name="calendar" size={20} color="#6D28D9" /></View>
            </TouchableOpacity>
          </Animated.View>

        </View>
      )}
      
      {/* Animated Rotating Main Button */}
      <TouchableOpacity 
        style={[styles.fabMain, isFabOpen ? { backgroundColor: '#EF4444' } : { backgroundColor: '#6D28D9' }]} 
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
  mainWrapper: { flex: 1, backgroundColor: '#F9FAFB' },
  loadingContainer: { flex: 1, backgroundColor: '#F9FAFB' },
  container: { flex: 1 },
  
  // Header
  header: { backgroundColor: '#6D28D9', paddingTop: 30, paddingBottom: 28, paddingHorizontal: 20, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, elevation: 4 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  welcome: { color: '#DDD6FE', fontSize: 14, fontFamily: Fonts.sans },
  name: { color: 'white', fontSize: 24, fontWeight: '700', marginTop: 2, fontFamily: Fonts.sans },
  iconCircle: { backgroundColor: 'rgba(255,255,255,0.2)', padding: 14, borderRadius: 50 },

  // Glassmorphic Quick Stats
  glassStatsRow: { flexDirection: 'row', gap: 12 },
  glassStatCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  glassStatIconRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  glassStatValue: { color: 'white', fontSize: 20, fontWeight: 'bold', fontFamily: Fonts.sans },
  glassStatLabel: { color: '#DDD6FE', fontSize: 12, fontFamily: Fonts.sans },

  content: { padding: 20 },
  section: { marginBottom: 32 },
  
  // Section Headers
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#111827', fontFamily: Fonts.sans, borderLeftWidth: 4, borderLeftColor: '#6D28D9', paddingLeft: 8 },
  joinButtonText: { color: '#6D28D9', fontSize: 14, fontWeight: '600', fontFamily: Fonts.sans }, 

  // Cards
  card: { backgroundColor: 'white', borderRadius: 16, marginBottom: 16, padding: 16, elevation: 3, shadowColor: '#111', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#1F2937', fontFamily: Fonts.sans },
  cardDescription: { fontSize: 13, color: '#6B7280', marginTop: 6, lineHeight: 20, fontFamily: Fonts.sans },
  
  // Custom AI Card Styling
  aiCard: { borderLeftWidth: 4, paddingLeft: 12 },
  aiDotRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },

  // Custom Session Card Styling
  sessionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  badgePill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#E5E7EB', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  badgePillText: { fontSize: 10, color: '#4B5563', fontWeight: '500', fontFamily: Fonts.sans },
  sessionFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  sessionFooterText: { fontSize: 12, color: '#6D28D9', fontWeight: '500', fontFamily: Fonts.sans },

  // Badges
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  badgeCard: { width: '22%', backgroundColor: '#FEFCE8', paddingVertical: 14, borderRadius: 12, alignItems: 'center', elevation: 1 },
  badgeIcon: { fontSize: 24, marginBottom: 4 },
  badgeLabel: { fontSize: 11, color: '#374151', fontWeight: '500', textAlign: 'center', fontFamily: Fonts.sans },

  // Floating Action Menu Styles
  fabMain: { position: 'absolute', bottom: 20, right: 20, width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 4 },
  fabMenu: { position: 'absolute', bottom: 90, right: 20, alignItems: 'flex-end' },
  fabMenuItemWrapper: { marginBottom: 16 }, 
  fabMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  fabMenuText: { backgroundColor: 'white', color: '#1F2937', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, fontSize: 13, fontWeight: '600', elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 3, overflow: 'hidden', fontFamily: Fonts.sans },
  fabMenuIconBox: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'white', justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3 },
});
