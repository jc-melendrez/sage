import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
  Platform, KeyboardAvoidingView, Image, TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { getCurrentUser, updateProfile } from '@/services/authService';
import { PFP_OPTIONS, pfpSource } from '@/constants/pfps';

const COLORS = {
  bg: '#FFFFFF',
  bgSecondary: '#F4F2FA',
  purpleDeep: '#4C1D95',
  purpleDark: '#6D28D9',
  purplePrimary: '#7C3AED',
  purpleVibrant: '#8B5CF6',
  purpleLight: '#A78BFA',
  purplePale: '#C4B5FD',
  textPrimary: '#3a107a',
  textSecondary: '#4B5563',
  textMuted: '#6B7280',
  border: 'rgba(124, 58, 237, 0.12)',
  danger: '#EF4444',
  success: '#10B981',
};

const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
};

export default function EditProfileScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const profile = await getCurrentUser();
        if (!profile) {
          router.replace('/login');
          return;
        }
        setUsername(profile.username || '');
        setFirstName(profile.first_name || '');
        setLastName(profile.last_name || '');
        setAvatar(profile.avatar || '');
      } catch (err: any) {
        setError(err?.message || 'Failed to load your profile.');
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [router]);

  const selectedSource = pfpSource(avatar);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateProfile({
        username: username.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        avatar,
      });
      router.back();
    } catch (err: any) {
      setError(err?.message || 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
      </View>
    );
  }

  const initials =
    firstName.trim()
      ? `${firstName.trim()[0]}${lastName.trim() ? lastName.trim()[0] : ''}`.toUpperCase()
      : username.substring(0, 2).toUpperCase();

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[COLORS.purpleDeep, COLORS.purpleDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerTop}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.8}>
            <Ionicons name="chevron-back" size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Profile</Text>
          <View style={styles.backButton} />
        </View>

        {selectedSource ? (
          <View style={styles.avatarWrap}>
            <Image source={selectedSource} style={styles.avatarImage} resizeMode="cover" />
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
        <Text style={styles.avatarHint}>Choose a profile picture for your avatar</Text>
      </LinearGradient>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
          <Text style={styles.sectionTitle}>Profile Picture</Text>
          <View style={styles.pfpGrid}>
            <TouchableOpacity
              style={[styles.pfpCell, avatar === '' && styles.pfpCellSelected]}
              onPress={() => setAvatar('')}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={[COLORS.purpleVibrant, COLORS.purpleLight]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.pfpThumb}
              >
                <Text style={styles.pfpInitials}>{firstName.trim() ? initials : username.substring(0, 2).toUpperCase()}</Text>
              </LinearGradient>
              {avatar === '' && <View style={styles.selectedBadge}><Ionicons name="checkmark" size={12} color="white" /></View>}
            </TouchableOpacity>

            {PFP_OPTIONS.map((pfp) => {
              const isSelected = avatar === pfp.key;
              return (
                <TouchableOpacity
                  key={pfp.key}
                  style={[styles.pfpCell, isSelected && styles.pfpCellSelected]}
                  onPress={() => setAvatar(pfp.key)}
                  activeOpacity={0.8}
                >
                  <Image source={pfp.source} style={styles.pfpThumb} resizeMode="cover" />
                  {isSelected && (
                    <View style={styles.selectedBadge}>
                      <Ionicons name="checkmark" size={12} color="white" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.sectionTitle}>Account Details</Text>
          <View style={styles.formCard}>
            <Text style={styles.modalLabel}>User Name</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="Enter your username"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.modalLabel}>First Name</Text>
            <TextInput
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Enter your first name"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="words"
            />

            <Text style={styles.modalLabel}>Last Name</Text>
            <TextInput
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
              placeholder="Enter your last name"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="words"
            />
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.saveButton, saving && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.saveButtonText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 24,
    paddingHorizontal: 24,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    alignItems: 'center',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 20,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: 'white',
  },
  avatarWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.45)',
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarText: { fontSize: 32, fontFamily: FONTS.black, color: 'white' },
  avatarHint: {
    marginTop: 12,
    fontSize: 13,
    fontFamily: FONTS.medium,
    color: COLORS.purplePale,
  },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  sectionTitle: {
    fontSize: 16,
    fontFamily: FONTS.extraBold,
    fontWeight: '900',
    letterSpacing: 1,
    color: COLORS.textPrimary,
    marginTop: 8,
    marginBottom: 16,
    textTransform: 'uppercase',
  },
  pfpGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 28 },
  pfpCell: {
    width: '18%',
    aspectRatio: 1,
    borderRadius: 40,
    padding: 3,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  pfpCellSelected: { borderColor: COLORS.purpleVibrant },
  pfpThumb: {
    flex: 1,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    width: '100%',
  },
  pfpInitials: { fontSize: 18, fontFamily: FONTS.black, color: 'white' },
  selectedBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.purpleVibrant,
    borderWidth: 2,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  formCard: {
    backgroundColor: COLORS.bg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
    marginBottom: 24,
  },
  modalLabel: {
    fontSize: 13,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 8,
    marginTop: 8,
  },
  input: {
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  error: {
    color: COLORS.danger,
    fontSize: 13,
    fontFamily: FONTS.medium,
    marginBottom: 16,
  },
  saveButton: {
    backgroundColor: COLORS.purpleDark,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
});