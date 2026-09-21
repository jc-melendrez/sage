import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
  StatusBar, Platform, Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import Constants from 'expo-constants';
import { getCurrentUser } from '@/services/authService';
import { pfpSource } from '@/constants/pfps';

const COLORS = {
  bg: '#FFFFFF',
  bgSecondary: '#F4F2FA',
  surface: '#FFFFFF',
  purpleDeep: '#4C1D95',
  purpleDark: '#6D28D9',
  purplePrimary: '#7C3AED',
  purpleVibrant: '#8B5CF6',
  purpleLight: '#A78BFA',
  purplePale: '#C4B5FD',
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

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

export default function SettingsScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState<any>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const profile = await getCurrentUser();
        if (active) setUserData(profile);
      } catch (error) {
        console.error('Failed to load profile in settings:', error);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.purpleDeep} translucent={false} />
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
  const avatarSource = pfpSource(userData?.avatar);
  const roleLabel = userData?.role === 'superadmin' ? 'Superadmin' : userData?.is_educator ? 'Educator' : 'Student';
  const memberSince = userData?.date_joined ? new Date(userData.date_joined).getFullYear() : null;

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
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.8} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Settings</Text>
          <View style={styles.backButton} />
        </View>

        <View style={styles.headerUserRow}>
          {avatarSource ? (
            <View style={[styles.avatarWrap, { overflow: 'hidden' }]}>
              <Image source={avatarSource} style={styles.avatarImage} resizeMode="cover" />
            </View>
          ) : (
            <LinearGradient
              colors={[COLORS.purpleVibrant, COLORS.purpleLight]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.avatarWrap}
            >
              <Text style={styles.avatarText}>{initials}</Text>
            </LinearGradient>
          )}
          <View style={styles.headerUserInfo}>
            <Text style={styles.headerUserName} numberOfLines={1}>{fullName}</Text>
            <Text style={styles.headerUserEmail} numberOfLines={1}>{userData?.email || 'No email provided'}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{roleLabel}</Text>
            </View>
          </View>
        </View>
      </LinearGradient>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.listCard}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/edit-profile' as Href)}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <View style={[styles.iconBg, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                  <Ionicons name="pencil" size={20} color={COLORS.purpleVibrant} />
                </View>
                <Text style={styles.menuItemText}>Edit Profile</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
            <View style={[styles.menuItem, styles.borderTop]}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.iconBg, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                  <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.success} />
                </View>
                <Text style={styles.menuItemText}>Role</Text>
              </View>
              <Text style={styles.menuItemValue}>{roleLabel}</Text>
            </View>
            {memberSince && (
              <View style={[styles.menuItem, styles.borderTop]}>
                <View style={styles.menuItemLeft}>
                  <View style={[styles.iconBg, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
                    <Ionicons name="calendar-outline" size={20} color={COLORS.warning} />
                  </View>
                  <Text style={styles.menuItemText}>Member since</Text>
                </View>
                <Text style={styles.menuItemValue}>{memberSince}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preferences</Text>
          <View style={styles.listCard}>
            <View style={styles.menuItem}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.iconBg, { backgroundColor: 'rgba(34, 211, 238, 0.15)' }]}>
                  <Ionicons name="notifications-outline" size={20} color={COLORS.accent} />
                </View>
                <Text style={styles.menuItemText}>Notifications</Text>
              </View>
              <Text style={styles.soonBadge}>Soon</Text>
            </View>
            <View style={[styles.menuItem, styles.borderTop]}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.iconBg, { backgroundColor: 'rgba(124, 58, 237, 0.15)' }]}>
                  <Ionicons name="moon-outline" size={20} color={COLORS.purplePrimary} />
                </View>
                <Text style={styles.menuItemText}>Dark Mode</Text>
              </View>
              <Text style={styles.soonBadge}>Soon</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <View style={styles.listCard}>
            <View style={styles.menuItem}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.iconBg, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                  <Ionicons name="information-circle-outline" size={20} color={COLORS.purpleVibrant} />
                </View>
                <Text style={styles.menuItemText}>Version</Text>
              </View>
              <Text style={styles.menuItemValue}>{APP_VERSION}</Text>
            </View>
          </View>
          <Text style={styles.footerText}>SAGE Learning — built for curious minds.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 24,
    paddingHorizontal: 24,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  backButton: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 20, fontFamily: FONTS.bold, fontWeight: '700', color: 'white' },
  headerUserRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  avatarText: { fontSize: 22, fontFamily: FONTS.black, fontWeight: '900', color: 'white' },
  avatarImage: { width: '100%', height: '100%' },
  headerUserInfo: { flex: 1 },
  headerUserName: { fontSize: 18, fontFamily: FONTS.bold, fontWeight: '700', color: 'white' },
  headerUserEmail: { fontSize: 13, fontFamily: FONTS.medium, fontWeight: '500', color: COLORS.purplePale, marginTop: 2 },
  roleBadge: {
    alignSelf: 'flex-start',
    marginTop: 6,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  roleText: { color: 'white', fontSize: 11, fontFamily: FONTS.semiBold, fontWeight: '600' },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  section: { marginBottom: 28 },
  sectionTitle: {
    fontSize: 18,
    fontFamily: FONTS.extraBold,
    fontWeight: '900',
    letterSpacing: 1,
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  listCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  borderTop: { borderTopWidth: 1, borderTopColor: COLORS.border },
  menuItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconBg: { width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center' },
  menuItemText: { fontSize: 15, color: COLORS.textPrimary, fontFamily: FONTS.medium, fontWeight: '500' },
  menuItemValue: { fontSize: 14, color: COLORS.textSecondary, fontFamily: FONTS.semiBold, fontWeight: '600' },
  soonBadge: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    backgroundColor: COLORS.bgSecondary,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },
  footerText: {
    marginTop: 16,
    textAlign: 'center',
    color: COLORS.textMuted,
    fontSize: 12,
    fontFamily: FONTS.medium,
    fontWeight: '500',
  },
});