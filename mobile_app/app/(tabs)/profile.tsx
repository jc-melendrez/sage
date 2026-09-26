import { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, StatusBar, Platform, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect, type Href } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentUser } from '@/services/authService';
import { pfpSource } from '@/constants/pfps';

// 🎨 Exact same tokens as Dashboard for a unified Design System
const COLORS = {
  bg: '#FFFFFF',
  bgSecondary: '#F4F2FA',
  surface: '#FFFFFF',
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
  textSecondary: '#4B5563',
  textMuted: '#6B7280',
  border: 'rgba(124, 58, 237, 0.12)',
};

const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
};

export default function ProfileScreen() {
  const { logout } = useAuth();
  const router = useRouter();
  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const profile = await getCurrentUser();
          if (active) setUserData(profile);
        } catch (error) {
          console.error("Failed to refresh profile:", error);
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  const openEdit = () => {
    router.push('/edit-profile' as Href);
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
      </View>
    );
  }

  const firstName = userData?.first_name || '';
  const lastName = userData?.last_name || '';
  const username = userData?.username || 'Student';
  const fullName = firstName || lastName ? `${firstName} ${lastName}`.trim() : username;
  const initials = firstName
    ? `${firstName[0]}${lastName ? lastName[0] : ''}`.toUpperCase()
    : username.substring(0, 2).toUpperCase();

  const earnedBadges = userData?.badges || [];
  const roleLabel = userData?.role === 'superadmin' ? 'Superadmin' : userData?.is_educator ? 'Educator' : 'Student';
  const avatarSource = pfpSource(userData?.avatar);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.purpleDeep} translucent={false} />

      <LinearGradient
        colors={[COLORS.purpleDeep, COLORS.purpleDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerTop}>
          {avatarSource && (
            <View style={[styles.avatarContainer, { overflow: 'hidden' }]}>
              <Image source={avatarSource} style={styles.avatarImage} resizeMode="cover" />
            </View>
          )}
          {!avatarSource && (
            <LinearGradient
              colors={[COLORS.purpleVibrant, COLORS.purpleLight]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.avatarContainer}
            >
              <Text style={styles.avatarText}>{initials}</Text>
            </LinearGradient>
          )}

          <View style={styles.userInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.userName} numberOfLines={1}>{fullName}</Text>
              <TouchableOpacity style={styles.editButton} onPress={openEdit} activeOpacity={0.8}>
                <Ionicons name="pencil" size={16} color="white" />
              </TouchableOpacity>
            </View>
            <Text style={styles.userEmail}>{userData?.email || 'No email provided'}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{roleLabel}</Text>
            </View>
          </View>
        </View>
      </LinearGradient>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Overview</Text>
          <View style={styles.overviewGrid}>
            <View style={styles.overviewCard}>
              <View style={[styles.overviewIconBg, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
                <Ionicons name="flame" size={24} color={COLORS.warning} />
              </View>
              <Text style={styles.overviewValue}>{userData?.streak || 0}</Text>
              <Text style={styles.overviewLabel}>Day Streak</Text>
            </View>
            <View style={styles.overviewCard}>
              <View style={[styles.overviewIconBg, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                <Ionicons name="trophy" size={24} color={COLORS.purpleVibrant} />
              </View>
              <Text style={styles.overviewValue}>{userData?.total_points || 0}</Text>
              <Text style={styles.overviewLabel}>Total Points</Text>
            </View>
            <View style={styles.overviewCard}>
              <View style={[styles.overviewIconBg, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                <Ionicons name="trending-up" size={24} color={COLORS.success} />
              </View>
              <Text style={styles.overviewValue}>Lv {userData?.level || 1}</Text>
              <Text style={styles.overviewLabel}>Level</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Statistics</Text>
          <View style={styles.listCard}>
            <View style={styles.listItem}>
              <View style={styles.listItemLeft}>
                <View style={[styles.listIconBg, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                  <Ionicons name="trophy-outline" size={20} color={COLORS.purpleVibrant} />
                </View>
                <Text style={styles.listItemText}>Courses Completed</Text>
              </View>
              <Text style={styles.listItemValue}>{userData?.courses_completed || 0}</Text>
            </View>
            <View style={[styles.listItem, styles.borderTop]}>
              <View style={styles.listItemLeft}>
                <View style={[styles.listIconBg, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                  <Ionicons name="time-outline" size={20} color={COLORS.purpleVibrant} />
                </View>
                <Text style={styles.listItemText}>Study Hours</Text>
              </View>
              <Text style={styles.listItemValue}>{userData?.study_hours || 0}</Text>
            </View>
            <View style={[styles.listItem, styles.borderTop]}>
              <View style={styles.listItemLeft}>
                <View style={[styles.listIconBg, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                  <Ionicons name="analytics-outline" size={20} color={COLORS.purpleVibrant} />
                </View>
                <Text style={styles.listItemText}>Quizzes Taken</Text>
              </View>
              <Text style={styles.listItemValue}>{userData?.quizzes_taken || 0}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Badges</Text>
          </View>
          <View style={styles.badgesGrid}>
            {earnedBadges.length > 0 ? (
              earnedBadges.map((badge: any) => (
                <View key={badge.id} style={styles.badgeCard}>
                  <LinearGradient
                    colors={[COLORS.purpleDark, COLORS.purpleVibrant]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.badgeIconContainer}
                  >
                    <Text style={styles.badgeEmoji}>{badge.icon || badge.icon_url || '🏆'}</Text>
                  </LinearGradient>
                  <Text style={styles.badgeName} numberOfLines={1}>{badge.name}</Text>
                  <View style={styles.earnedPill}>
                    <Ionicons name="checkmark-circle" size={12} color={COLORS.success} />
                    <Text style={styles.earnedText}>Earned</Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptyBadges}>
                <Text style={styles.emptyBadgesText}>Complete activities to earn badges!</Text>
              </View>
            )}
          </View>
        </View>

        {/* Menu Items */}
        <View style={styles.section}>
          <View style={styles.listCard}>
            {userData?.is_educator && (
              <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/educator/dashboard')}>
                <View style={styles.menuItemLeft}>
                  <Ionicons name="school-outline" size={22} color={COLORS.textSecondary} />
                  <Text style={styles.menuItemText}>Educator View</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/settings' as Href)}>
              <View style={styles.menuItemLeft}>
                <Ionicons name="settings-outline" size={22} color={COLORS.textSecondary} />
                <Text style={styles.menuItemText}>Settings</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
{userData?.role === 'superadmin' && (
              <TouchableOpacity style={[styles.menuItem, styles.borderTop]} onPress={() => router.push('/superadmin')}>
                <View style={styles.menuItemLeft}>
                  <Ionicons name="terminal-outline" size={22} color={COLORS.purpleDeep} />
                  <Text style={styles.menuItemText}>Developer Panel</Text>
                </View>
                <View style={styles.menuItemRight}>
                  <Text style={styles.menuItemHint}>Super Admin</Text>
                  <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                </View>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.menuItem, styles.borderTop]} onPress={handleLogout}>
              <View style={styles.menuItemLeft}>
                <Ionicons name="log-out-outline" size={22} color={COLORS.danger} />
                <Text style={[styles.menuItemText, { color: COLORS.danger }]}>Log Out</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.footer}>
          <Ionicons name="calendar-outline" size={16} color={COLORS.textMuted} />
          <Text style={styles.footerText}>Member since {userData?.date_joined ? new Date(userData.date_joined).getFullYear() : '2026'}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 28,
    paddingHorizontal: 24,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24 },
  avatarContainer: {
    width: 76,
    height: 76,
    borderRadius: 38,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.45)',
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarText: { fontSize: 26, fontFamily: FONTS.black, color: 'white' },
  avatarImage: { width: '100%', height: '100%' },
  userInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  editButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userName: {
    flexShrink: 1,
    fontSize: 26,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: 'white',
    letterSpacing: -0.5
  },
  userEmail: {
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.purplePale,
    marginBottom: 8
  },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  roleText: {
    color: 'white',
    fontSize: 12,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
  },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  section: { marginBottom: 28 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: {
    fontSize: 18,
    fontFamily: FONTS.extraBold,
    fontWeight: '900',
    letterSpacing: 1,
    color: COLORS.textPrimary,
    marginBottom: 16
  },
  viewAllText: {
    color: COLORS.purpleDeep,
    fontSize: 14,
    fontFamily: FONTS.extraBold,
    fontWeight: '500',
  },
  overviewGrid: { flexDirection: 'row', gap: 12 },
  overviewCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    paddingVertical: 20,
    paddingHorizontal: 12,
    borderRadius: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  overviewIconBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  overviewValue: {
    fontSize: 24,
    fontFamily: FONTS.black,
    fontWeight: '900',
    color: COLORS.textPrimary,
    marginBottom: 4,
    letterSpacing: -0.5
  },
  overviewLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  listCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  listItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18 },
  borderTop: { borderTopWidth: 1, borderTopColor: COLORS.border },
  listItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  listIconBg: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  listItemText: {
    fontSize: 15,
    color: COLORS.textPrimary,
    fontFamily: FONTS.medium,
    fontWeight: '500',
  },
  listItemValue: {
    fontSize: 18,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textPrimary
  },
  badgesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  badgeCard: {
    width: '31%',
    backgroundColor: COLORS.surface,
    paddingVertical: 18,
    paddingHorizontal: 8,
    borderRadius: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  badgeIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  badgeEmoji: { fontSize: 28 },
  badgeName: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center'
  },
  earnedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  earnedText: {
    fontSize: 10,
    color: COLORS.success,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
  },
  emptyBadges: { padding: 24, alignItems: 'center', width: '100%', backgroundColor: COLORS.surface, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border },
  emptyBadgesText: {
    color: COLORS.textSecondary,
    fontFamily: FONTS.medium,
    fontWeight: '500',
    textAlign: 'center'
  },
  menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18 },
  menuItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  menuItemText: {
    fontSize: 16,
    color: COLORS.textPrimary,
    fontFamily: FONTS.medium,
    fontWeight: '500',
  },
  menuItemRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  menuItemHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontFamily: FONTS.medium,
    fontWeight: '500',
  },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 8, paddingBottom: 20 },
  footerText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontFamily: FONTS.medium,
    fontWeight: '500',
  },
});