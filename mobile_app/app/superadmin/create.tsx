import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AdminHeader from '@/components/admin/AdminHeader';
import { COLORS, FONTS } from '@/constants/adminTheme';
import { superadminService, Role, School } from '@/services/adminService';

const ROLE_OPTIONS: { role: Role; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { role: 'superadmin', label: 'Superadmin', icon: 'shield-checkmark-outline' },
  { role: 'admin', label: 'Admin', icon: 'business-outline' },
  { role: 'educator', label: 'Educator', icon: 'book-outline' },
  { role: 'student', label: 'Student', icon: 'school-outline' },
];

export default function SuperAdminCreateUser() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<Role>('superadmin');
  const [schoolId, setSchoolId] = useState<number | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const loadSchools = useCallback(async () => {
    try {
      setSchools(await superadminService.listSchools());
    } catch {
      setSchools([]);
    }
  }, []);

  useEffect(() => {
    loadSchools();
  }, [loadSchools]);

  const showSchoolPicker = role !== 'superadmin';

  const submit = async () => {
    if (!username.trim() || !email.trim() || !password) {
      Alert.alert('Missing info', 'Username, email and password are required.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Weak password', 'Password must be at least 8 characters.');
      return;
    }
    if (showSchoolPicker && !schoolId) {
      Alert.alert('Missing info', 'Select a school for this user.');
      return;
    }
    try {
      setSubmitting(true);
      const user = await superadminService.createUser({
        username: username.trim(),
        email: email.trim(),
        password,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        role,
        school: showSchoolPicker ? schoolId : null,
      });
      Alert.alert('User created', `${user.username} created as ${user.role}.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Could not create user.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <AdminHeader
        title="Create User"
        subtitle="Provision a platform or school account"
        variant="superadmin"
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, gap: 12 }}>
          <Text style={styles.sectionLabel}>ROLE</Text>
          <View style={styles.roleGrid}>
            {ROLE_OPTIONS.map((opt) => {
              const active = role === opt.role;
              return (
                <TouchableOpacity
                  key={opt.role}
                  style={[styles.roleOption, active && styles.roleOptionActive]}
                  onPress={() => {
                    setRole(opt.role);
                    if (opt.role === 'superadmin') setSchoolId(null);
                  }}
                >
                  <Ionicons name={opt.icon} size={14} color={active ? '#0B1020' : COLORS.superAdminGlow} />
                  <Text style={[styles.roleOptionText, active && styles.roleOptionTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>ACCOUNT</Text>
          <TextInput style={styles.input} placeholder="Username" placeholderTextColor="#64748B" value={username} onChangeText={setUsername} autoCapitalize="none" />
          <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#64748B" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <TextInput style={styles.input} placeholder="Password (min 8 chars)" placeholderTextColor="#64748B" value={password} onChangeText={setPassword} secureTextEntry />
          <TextInput style={styles.input} placeholder="First name" placeholderTextColor="#64748B" value={firstName} onChangeText={setFirstName} />
          <TextInput style={styles.input} placeholder="Last name" placeholderTextColor="#64748B" value={lastName} onChangeText={setLastName} />

          {showSchoolPicker && (
            <>
              <Text style={styles.sectionLabel}>SCHOOL</Text>
              {schools.length === 0 ? (
                <Text style={styles.hintText}>No schools registered yet.</Text>
              ) : (
                <View style={styles.schoolList}>
                  {schools.map((school) => {
                    const active = schoolId === school.id;
                    return (
                      <TouchableOpacity
                        key={school.id}
                        style={[styles.schoolOption, active && styles.schoolOptionActive]}
                        onPress={() => setSchoolId(school.id)}
                      >
                        <Ionicons name="business-outline" size={14} color={active ? '#0B1020' : '#94A3B8'} />
                        <Text style={[styles.schoolOptionText, active && styles.schoolOptionTextActive]}>{school.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </>
          )}

          <Text style={styles.hintText}>
            {role === 'superadmin'
              ? 'Superadmins get a Firebase Auth account automatically so they can sign in on the app with this email + password.'
              : 'This user can sign in on the app with this email + password.'}
          </Text>

          <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#0B1020" /> : <Ionicons name="shield-checkmark" size={16} color="#0B1020" />}
            {!submitting && <Text style={styles.submitBtnText}>Create User</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1020' },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    letterSpacing: 1,
    color: COLORS.superAdminGlow,
    marginTop: 4,
  },
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  roleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#151B2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.25)',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  roleOptionActive: { backgroundColor: COLORS.superAdminGlow, borderColor: COLORS.superAdminGlow },
  roleOptionText: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: '#F1F5F9' },
  roleOptionTextActive: { color: '#0B1020' },
  input: {
    backgroundColor: '#151B2E',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: '#F1F5F9',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.15)',
  },
  schoolList: { gap: 8 },
  schoolOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#151B2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.15)',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  schoolOptionActive: { backgroundColor: COLORS.superAdminGlow, borderColor: COLORS.superAdminGlow },
  schoolOptionText: { fontSize: 13, fontFamily: FONTS.medium, color: '#F1F5F9' },
  schoolOptionTextActive: { color: '#0B1020' },
  hintText: { fontSize: 12, fontFamily: FONTS.medium, color: '#64748B', lineHeight: 17 },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.superAdminGlow,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 4,
  },
  submitBtnText: { color: '#0B1020', fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700' },
});
