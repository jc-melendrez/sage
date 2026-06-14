import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentUser } from '@/services/authService';

export default function ProfileScreen() {
  const { logout } = useAuth();
  const router = useRouter();

  // Dynamic Data State
  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Fetch the real user data on load
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const profile = await getCurrentUser();
        setUserData(profile);
      } catch (error) {
        console.error("Failed to load profile:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#6D28D9" />
      </View>
    );
  }

  // --- Dynamic Data Mapping ---
  const firstName = userData?.first_name || '';
  const lastName = userData?.last_name || '';
  const username = userData?.username || 'Student';
  
  const fullName = firstName || lastName ? `${firstName} ${lastName}`.trim() : username;
  const initials = firstName 
    ? `${firstName[0]}${lastName ? lastName[0] : ''}`.toUpperCase() 
    : username.substring(0, 2).toUpperCase();

  const currentXP = userData?.current_xp || 0;
  const nextLevelXP = userData?.next_level_xp || 1000;
  const progressPercent = Math.min((currentXP / nextLevelXP) * 100, 100);

  const earnedBadges = userData?.badges || [];
  
  return (
    <View style={styles.container}>
      
      {/* 🌟 FIGMA DESIGN: Purple Gradient-Style Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.avatarContainer}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{fullName}</Text>
            <Text style={styles.userEmail}>{userData?.email || 'No email provided'}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>Student</Text>
            </View>
          </View>
        </View>

        {/* 🌟 FIGMA DESIGN: Glassmorphic Level Progress inside Header */}
        <View style={styles.glassCard}>
          <View style={styles.glassCardHeader}>
            <View style={styles.levelBadge}>
              <Ionicons name="star" size={16} color="#FBBF24" />
              <Text style={styles.levelText}>Level {userData?.level || 1}</Text>
            </View>
            <Text style={styles.xpText}>{currentXP} / {nextLevelXP} XP</Text>
          </View>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
          </View>
          <Text style={styles.xpRemainingText}>{nextLevelXP - currentXP} XP to next level</Text>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        
        {/* 🌟 FIGMA DESIGN: Overview Colored Stat Blocks */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Overview</Text>
          <View style={styles.overviewGrid}>
            
            <View style={[styles.overviewCard, { backgroundColor: '#FFF7ED' }]}>
              <Ionicons name="flame" size={32} color="#F97316" style={styles.overviewIcon} />
              <Text style={styles.overviewValue}>{userData?.streak || 0}</Text>
              <Text style={styles.overviewLabel}>Day Streak</Text>
            </View>

            <View style={[styles.overviewCard, { backgroundColor: '#FEFCE8' }]}>
              <Ionicons name="trophy" size={32} color="#EAB308" style={styles.overviewIcon} />
              <Text style={styles.overviewValue}>{userData?.total_points || 0}</Text>
              <Text style={styles.overviewLabel}>Total Points</Text>
            </View>

            <View style={[styles.overviewCard, { backgroundColor: '#ECFDF5' }]}>
              <Ionicons name="trending-up" size={32} color="#10B981" style={styles.overviewIcon} />
              <Text style={styles.overviewValue}>Lv {userData?.level || 1}</Text>
              <Text style={styles.overviewLabel}>Level</Text>
            </View>

          </View>
        </View>

        {/* 🌟 FIGMA DESIGN: Detailed Statistics List */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Statistics</Text>
          <View style={styles.listCard}>
            
            <View style={styles.listItem}>
              <View style={styles.listItemLeft}>
                <View style={styles.listIconBg}>
                  <Ionicons name="trophy-outline" size={20} color="#7C3AED" />
                </View>
                <Text style={styles.listItemText}>Courses Completed</Text>
              </View>
              <Text style={styles.listItemValue}>{userData?.courses_completed || 0}</Text>
            </View>

            <View style={[styles.listItem, styles.borderTop]}>
              <View style={styles.listItemLeft}>
                <View style={styles.listIconBg}>
                  <Ionicons name="time-outline" size={20} color="#7C3AED" />
                </View>
                <Text style={styles.listItemText}>Study Hours</Text>
              </View>
              <Text style={styles.listItemValue}>{userData?.study_hours || 0}</Text>
            </View>

            <View style={[styles.listItem, styles.borderTop]}>
              <View style={styles.listItemLeft}>
                <View style={styles.listIconBg}>
                  <Ionicons name="analytics-outline" size={20} color="#7C3AED" />
                </View>
                <Text style={styles.listItemText}>Quizzes Taken</Text>
              </View>
              <Text style={styles.listItemValue}>{userData?.quizzes_taken || 0}</Text>
            </View>

          </View>
        </View>

        {/* 🌟 FIGMA DESIGN: Badges Grid */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Badges</Text>
            <TouchableOpacity><Text style={styles.viewAllText}>View All</Text></TouchableOpacity>
          </View>
          
          <View style={styles.badgesGrid}>
            {earnedBadges.length > 0 ? (
              earnedBadges.map((badge: any) => (
                <View key={badge.id} style={styles.badgeCard}>
                  <Text style={styles.badgeEmoji}>{badge.icon || badge.icon_url || '🏆'}</Text>
                  <Text style={styles.badgeName} numberOfLines={1}>{badge.name}</Text>
                  <View style={styles.earnedPill}>
                    <Ionicons name="checkmark-circle" size={12} color="#16A34A" />
                    <Text style={styles.earnedText}>Earned</Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={{ padding: 20, alignItems: 'center', width: '100%' }}>
                <Text style={{ color: '#999', textAlign: 'center' }}>Complete activities to earn badges!</Text>
              </View>
            )}
          </View>
        </View>

        {/* 🌟 FIGMA DESIGN: Menu Items */}
        <View style={styles.section}>
          <View style={styles.listCard}>
            
            <TouchableOpacity style={styles.menuItem}>
              <View style={styles.menuItemLeft}>
                <Ionicons name="notifications-outline" size={22} color="#1F2937" />
                <Text style={styles.menuItemText}>Notifications</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            <TouchableOpacity style={[styles.menuItem, styles.borderTop]}>
              <View style={styles.menuItemLeft}>
                <Ionicons name="settings-outline" size={22} color="#1F2937" />
                <Text style={styles.menuItemText}>Settings</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            <TouchableOpacity style={[styles.menuItem, styles.borderTop]} onPress={handleLogout}>
              <View style={styles.menuItemLeft}>
                <Ionicons name="log-out-outline" size={22} color="#DC2626" />
                <Text style={[styles.menuItemText, { color: '#DC2626' }]}>Log Out</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
            </TouchableOpacity>

          </View>
        </View>

        {/* Member Since */}
        <View style={styles.footer}>
          <Ionicons name="calendar-outline" size={16} color="#6B7280" />
          <Text style={styles.footerText}>Member since {userData?.date_joined ? new Date(userData.date_joined).getFullYear() : '2026'}</Text>
        </View>

      </ScrollView>
      <TouchableOpacity onPress={() => router.push('/game')}>
        <Text>Play Classic Mode</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  
  // Header Styles
  header: { backgroundColor: '#6D28D9', paddingTop: 20, paddingBottom: 24, paddingHorizontal: 20, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, elevation: 4 },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24 },
  avatarContainer: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 24, fontWeight: 'bold', color: 'white' },
  userInfo: { flex: 1 },
  userName: { fontSize: 24, fontWeight: '700', color: 'white', marginBottom: 4 },
  userEmail: { fontSize: 14, color: '#DDD6FE', marginBottom: 8 },
  roleBadge: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  roleText: { color: 'white', fontSize: 12, fontWeight: '600' },
  
  // Glassmorphic Progress Card
  glassCard: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  glassCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  levelBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  levelText: { color: 'white', fontWeight: '600', fontSize: 16 },
  xpText: { color: 'white', fontSize: 14 },
  progressBarBg: { height: 8, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 4, overflow: 'hidden', marginBottom: 8 },
  progressBarFill: { height: '100%', backgroundColor: 'white', borderRadius: 4 },
  xpRemainingText: { color: '#DDD6FE', fontSize: 12 },

  content: { flex: 1, padding: 20 },
  section: { marginBottom: 24 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#111827', marginBottom: 12 },
  viewAllText: { color: '#7C3AED', fontSize: 14, fontWeight: '500' },

  // Colored Overview Grid
  overviewGrid: { flexDirection: 'row', gap: 12 },
  overviewCard: { flex: 1, paddingVertical: 16, paddingHorizontal: 8, borderRadius: 16, alignItems: 'center', elevation: 1 },
  overviewIcon: { marginBottom: 8 },
  overviewValue: { fontSize: 22, fontWeight: 'bold', color: '#111827', marginBottom: 4 },
  overviewLabel: { fontSize: 12, color: '#4B5563', textAlign: 'center' },

  // List Cards
  listCard: { backgroundColor: 'white', borderRadius: 16, elevation: 2, overflow: 'hidden' },
  listItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  borderTop: { borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  listItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  listIconBg: { backgroundColor: '#F3E8FF', padding: 8, borderRadius: 50 },
  listItemText: { fontSize: 15, color: '#374151', fontWeight: '500' },
  listItemValue: { fontSize: 18, fontWeight: '600', color: '#111827' },

  // Badges Grid
  badgesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  badgeCard: { width: '31%', backgroundColor: '#FEFCE8', paddingVertical: 16, paddingHorizontal: 8, borderRadius: 16, alignItems: 'center', elevation: 1 },
  badgeEmoji: { fontSize: 32, marginBottom: 8 },
  badgeName: { fontSize: 12, color: '#374151', fontWeight: '500', marginBottom: 8, textAlign: 'center' },
  earnedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#22C55E', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 12 },
  earnedText: { fontSize: 10, color: '#16A34A', fontWeight: '600' },

  // Menu Items
  menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: 'white' },
  menuItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  menuItemText: { fontSize: 16, color: '#111827', fontWeight: '500' },

  // Footer
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 8, paddingBottom: 20 },
  footerText: { color: '#6B7280', fontSize: 14 },
});