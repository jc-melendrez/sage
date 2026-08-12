import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform, StatusBar } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentUser } from '@/services/authService';
import { COLORS, FONTS, RADIUS } from '@/constants/educatorTheme';

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
        console.error("Failed to load educator profile:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const handleLogout = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out of your educator account?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/login');
          },
        },
      ]
    );
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
  const username = userData?.username || 'Educator';
  const fullName = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : username;
  const initials = firstName
    ? `${firstName[0]}${lastName ? lastName[0] : ''}`.toUpperCase()
    : username.substring(0, 2).toUpperCase();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.purpleDeep} translucent={false} />

      {/* Header */}
      <LinearGradient
        colors={[COLORS.purpleDeep, COLORS.purpleDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerTop}>
          <LinearGradient
            colors={[COLORS.purpleVibrant, COLORS.purpleLight]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatarContainer}
          >
            <Text style={styles.avatarText}>{initials}</Text>
          </LinearGradient>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{fullName}</Text>
            <Text style={styles.userEmail}>{userData?.email || 'No email provided'}</Text>
            <View style={styles.roleBadge}>
              <Ionicons name="school" size={12} color="white" />
              <Text style={styles.roleText}>Educator</Text>
            </View>
          </View>
        </View>
      </LinearGradient>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        
        {/* Account Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.listCard}>
            <View style={styles.menuItem}>
              <View style={styles.menuItemLeft}>
                <View style={styles.menuIconBox}><Ionicons name="person-outline" size={20} color={COLORS.purpleVibrant} /></View>
                <Text style={styles.menuItemText}>Username</Text>
              </View>
              <Text style={styles.menuItemValue}>{userData?.username}</Text>
            </View>
            <View style={[styles.menuItem, styles.borderTop]}>
              <View style={styles.menuItemLeft}>
                <View style={styles.menuIconBox}><Ionicons name="mail-outline" size={20} color={COLORS.purpleVibrant} /></View>
                <Text style={styles.menuItemText}>Email</Text>
              </View>
              <Text style={styles.menuItemValue} numberOfLines={1}>{userData?.email}</Text>
            </View>
            <View style={[styles.menuItem, styles.borderTop]}>
              <View style={styles.menuItemLeft}>
                <View style={styles.menuIconBox}><Ionicons name="calendar-outline" size={20} color={COLORS.purpleVibrant} /></View>
                <Text style={styles.menuItemText}>Member Since</Text>
              </View>
              <Text style={styles.menuItemValue}>
                {userData?.date_joined ? new Date(userData.date_joined).toLocaleDateString() : '—'}
              </Text>
            </View>
          </View>
        </View>

        {/* Quick Links */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Access</Text>
          <View style={styles.listCard}>
            <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/educator/courses')}>
              <View style={styles.menuItemLeft}>
                <View style={styles.menuIconBox}><Ionicons name="book-outline" size={20} color={COLORS.purpleVibrant} /></View>
                <Text style={styles.menuItemText}>My Courses</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuItem, styles.borderTop]} onPress={() => router.push('/educator/quiz-manager')}>
              <View style={styles.menuItemLeft}>
                <View style={styles.menuIconBox}><Ionicons name="document-text-outline" size={20} color={COLORS.purpleVibrant} /></View>
                <Text style={styles.menuItemText}>Quiz Manager</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuItem, styles.borderTop]} onPress={() => router.push('/educator/analytics')}>
              <View style={styles.menuItemLeft}>
                <View style={styles.menuIconBox}><Ionicons name="stats-chart-outline" size={20} color={COLORS.purpleVibrant} /></View>
                <Text style={styles.menuItemText}>Analytics</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Logout Button */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.8}>
            <Ionicons name="log-out-outline" size={20} color={COLORS.danger} />
            <Text style={styles.logoutText}>Log Out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>SAGE Learning · Educator Portal v1.0</Text>
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
    width: 72, height: 72, borderRadius: 36,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: COLORS.purpleDeep, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  avatarText: { fontSize: 24, fontFamily: FONTS.black, color: 'white' },
  userInfo: { flex: 1 },
  userName: { fontSize: 24, fontFamily: FONTS.bold, color: 'white', marginBottom: 4, letterSpacing: -0.5 },
  userEmail: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.purplePale, marginBottom: 8 },
  roleBadge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  roleText: { color: 'white', fontSize: 12, fontFamily: FONTS.semiBold },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 18, fontFamily: FONTS.extraBold, letterSpacing: 1, color: COLORS.textPrimary, marginBottom: 16 },
  listCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18 },
  borderTop: { borderTopWidth: 1, borderTopColor: COLORS.border },
  menuItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  menuIconBox: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(139,92,246,0.12)', justifyContent: 'center', alignItems: 'center' },
  menuItemText: { fontSize: 15, fontFamily: FONTS.medium, color: COLORS.textPrimary },
  menuItemValue: { fontSize: 14, fontFamily: FONTS.semiBold, color: COLORS.textMuted, maxWidth: '50%', textAlign: 'right' },
  logoutButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: RADIUS.lg,
    paddingVertical: 16, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)',
  },
  logoutText: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.danger },
  footer: { alignItems: 'center', marginTop: 8 },
  footerText: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted },
});