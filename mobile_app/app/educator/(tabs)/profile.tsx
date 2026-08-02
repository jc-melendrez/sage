import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentUser } from '@/services/authService';
import { COLORS, FONTS } from '@/constants/educatorTheme';

export default function EducatorProfileScreen() {
  const { logout } = useAuth();
  const router = useRouter();
  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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
        <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
      </View>
    );
  }

  const firstName = userData?.first_name || 'Educator';
  const lastName = userData?.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  const email = userData?.email || 'educator@example.com';
  const initials = fullName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'ED';

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[COLORS.purpleDeep, COLORS.purpleDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerTop}>
          <View style={styles.avatarContainer}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{fullName}</Text>
            <Text style={styles.userEmail}>{email}</Text>
            <View style={styles.roleBadge}>
              <Ionicons name="school" size={12} color="white" />
              <Text style={styles.roleText}>Educator</Text>
            </View>
          </View>
        </View>
      </LinearGradient>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.section}>
          <View style={styles.listCard}>
            <TouchableOpacity style={styles.menuItem}>
              <View style={styles.menuItemLeft}>
                <Ionicons name="notifications-outline" size={22} color={COLORS.textSecondary} />
                <Text style={styles.menuItemText}>Notifications</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuItem, styles.borderTop]}>
              <View style={styles.menuItemLeft}>
                <Ionicons name="settings-outline" size={22} color={COLORS.textSecondary} />
                <Text style={styles.menuItemText}>Settings</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
            {/* 🔐 Admin / Super Admin access
                NOTE: currently visible to everyone since the backend doesn't yet expose
                a role/is_admin flag to the app. Once `userData.is_admin` (or similar)
                is returned by the API, wrap these two items in that check. */}
            <TouchableOpacity style={[styles.menuItem, styles.borderTop]} onPress={() => router.push('/admin')}>
              <View style={styles.menuItemLeft}>
                <Ionicons name="shield-checkmark-outline" size={22} color={COLORS.purpleVibrant} />
                <Text style={styles.menuItemText}>Admin Panel</Text>
              </View>
              <View style={styles.menuItemRight}>
                <Text style={styles.menuItemHint}>Dean / Program Chair</Text>
                <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
              </View>
            </TouchableOpacity>
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
            <TouchableOpacity style={[styles.menuItem, styles.borderTop]} onPress={handleLogout}>
              <View style={styles.menuItemLeft}>
                <Ionicons name="log-out-outline" size={22} color={COLORS.danger} />
                <Text style={[styles.menuItemText, { color: COLORS.danger }]}>Log Out</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
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
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatarContainer: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  avatarText: { fontSize: 26, fontFamily: FONTS.black, color: 'white' },
  userInfo: { flex: 1 },
  userName: {
    fontSize: 26,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: 'white',
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  userEmail: {
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.purplePale,
    marginBottom: 8,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  listCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  borderTop: { borderTopWidth: 1, borderTopColor: COLORS.border },
  menuItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16 },
  menuItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  menuItemRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  menuItemText: { fontSize: 15, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary },
  menuItemHint: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted },
});
