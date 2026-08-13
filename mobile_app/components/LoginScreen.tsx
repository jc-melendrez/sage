import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { 
  View, Text, TextInput, TouchableOpacity, StyleSheet, 
  ActivityIndicator, Alert, Platform, StatusBar, KeyboardAvoidingView 
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { roleHomePath } from '../services/authService';

type AccountType = 'student' | 'educator' | 'admin';

const ROLE_OPTIONS: { type: AccountType; label: string; icon: string }[] = [
  { type: 'student', label: 'Student', icon: 'school-outline' },
  { type: 'educator', label: 'Educator', icon: 'book-outline' },
  { type: 'admin', label: 'Admin', icon: 'shield-checkmark-outline' },
];

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
  textPrimary: '#FFFFFF',
  textSecondary: '#E9D5FF',
  textMuted: '#C4B5FD',
  inputText: '#1F2937',
  border: 'rgba(255, 255, 255, 0.2)',
};

const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
};

export default function LoginScreen() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();
  const { login, register, loading, error, clearError } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('student');

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    try {
      clearError();
      const response = await login({ username: email, password: password });
      router.replace(roleHomePath(response.user));
    } catch (err) {
      Alert.alert('Login Failed', error || 'Please check your credentials');
    }
  };

  const handleSignUp = async () => {
    if (!username || !email || !password || !firstName || !lastName) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    try {
      clearError();
      const response = await register({
        username,
        email,
        password,
        first_name: firstName,
        last_name: lastName,
        is_student: accountType === 'student',
        is_educator: accountType === 'educator',
        is_admin: accountType === 'admin',
      });
      router.replace(roleHomePath(response.user));
    } catch (err) {
      Alert.alert('Sign Up Failed', error || 'Please try again');
    }
  };

  return (
    <LinearGradient
      colors={[COLORS.purpleDeep, COLORS.purpleDark, COLORS.purplePrimary]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <View style={styles.content}>
            {/* Fixed Header - slightly shorter */}
            <View style={styles.header}>
              <View style={styles.logoContainer}>
                <LinearGradient
                  colors={[COLORS.purpleVibrant, COLORS.purpleLight]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.logoCircle}
                >
                  <Ionicons name="sparkles" size={24} color="white" />
                </LinearGradient>
              </View>
              <Text style={styles.title}>SAGE</Text>
              <Text style={styles.subtitle}>
                Smart Assistant for Group-Based Education
              </Text>
            </View>

            {/* Card – now with marginTop to push it lower */}
            <View style={styles.cardWrapper}>
              <View style={styles.card}>
                <View style={styles.tabContainer}>
                  <TouchableOpacity 
                    style={[styles.tab, !isSignUp && styles.activeTab]}
                    onPress={() => setIsSignUp(false)}
                    disabled={loading}
                  >
                    <Text style={[styles.tabText, !isSignUp && styles.activeTabText]}>
                      Log In
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.tab, isSignUp && styles.activeTab]}
                    onPress={() => setIsSignUp(true)}
                    disabled={loading}
                  >
                    <Text style={[styles.tabText, isSignUp && styles.activeTabText]}>
                      Sign Up
                    </Text>
                  </TouchableOpacity>
                </View>

                {error && (
                  <View style={styles.errorContainer}>
                    <Ionicons name="alert-circle" size={14} color="#FCA5A5" />
                    <Text style={styles.errorText}>{error}</Text>
                    <TouchableOpacity onPress={clearError}>
                      <Ionicons name="close" size={14} color="#FCA5A5" />
                    </TouchableOpacity>
                  </View>
                )}

                {isSignUp && (
                  <>
                    <View style={styles.inputWrapper}>
                      <Ionicons name="person-outline" size={14} color={COLORS.purpleDeep} style={styles.inputIcon} />
                      <TextInput 
                        placeholder="First Name" 
                        style={styles.input} 
                        value={firstName} 
                        onChangeText={setFirstName} 
                        placeholderTextColor="#9CA3AF"
                      />
                    </View>
                    <View style={styles.inputWrapper}>
                      <Ionicons name="person-outline" size={14} color={COLORS.purpleDeep} style={styles.inputIcon} />
                      <TextInput 
                        placeholder="Last Name" 
                        style={styles.input} 
                        value={lastName} 
                        onChangeText={setLastName} 
                        placeholderTextColor="#9CA3AF"
                      />
                    </View>
                    <View style={styles.inputWrapper}>
                      <Ionicons name="at-outline" size={14} color={COLORS.purpleDeep} style={styles.inputIcon} />
                      <TextInput 
                        placeholder="Username" 
                        style={styles.input} 
                        value={username} 
                        onChangeText={setUsername} 
                        autoCapitalize="none"
                        placeholderTextColor="#9CA3AF"
                      />
                    </View>
                  </>
                )}

                <View style={styles.inputWrapper}>
                  <Ionicons name="mail-outline" size={14} color={COLORS.purpleDeep} style={styles.inputIcon} />
                  <TextInput 
                    placeholder="Email Address" 
                    keyboardType="email-address" 
                    autoCapitalize="none"
                    style={styles.input} 
                    value={email} 
                    onChangeText={setEmail} 
                    placeholderTextColor="#9CA3AF"
                  />
                </View>

                <View style={styles.inputWrapper}>
                  <Ionicons name="lock-closed-outline" size={14} color={COLORS.purpleDeep} style={styles.inputIcon} />
                  <TextInput 
                    placeholder="Password" 
                    secureTextEntry={!showPassword}
                    style={[styles.input, { flex: 1 }]} 
                    value={password} 
                    onChangeText={setPassword} 
                    placeholderTextColor="#9CA3AF"
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                    <Ionicons 
                      name={showPassword ? "eye-off-outline" : "eye-outline"} 
                      size={16} 
                      color={COLORS.purpleDeep} 
                    />
                  </TouchableOpacity>
                </View>

                {!isSignUp && (
                  <TouchableOpacity style={styles.forgotPassword}>
                    <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
                  </TouchableOpacity>
                )}

                {isSignUp && (
                  <View style={styles.rolePicker}>
                    <Text style={styles.rolePickerLabel}>I am a...</Text>
                    <View style={styles.roleOptions}>
                      {ROLE_OPTIONS.map((role) => {
                        const active = accountType === role.type;
                        return (
                          <TouchableOpacity
                            key={role.type}
                            style={[styles.roleOption, active && styles.roleOptionActive]}
                            onPress={() => setAccountType(role.type)}
                            disabled={loading}
                          >
                            <Ionicons
                              name={role.icon as any}
                              size={14}
                              color={active ? 'white' : COLORS.purpleDeep}
                            />
                            <Text style={[styles.roleOptionText, active && styles.roleOptionTextActive]}>
                              {role.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}

                <TouchableOpacity 
                  style={[styles.submitButton, loading && styles.submitButtonDisabled]} 
                  onPress={isSignUp ? handleSignUp : handleLogin} 
                  disabled={loading}
                >
                  <LinearGradient
                    colors={[COLORS.purplePrimary, COLORS.purpleVibrant]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.submitButtonGradient}
                  >
                    {loading ? (
                      <ActivityIndicator color="white" size="small" />
                    ) : (
                      <>
                        <Text style={styles.submitButtonText}>
                          {isSignUp ? 'Create Account' : 'Log In'}
                        </Text>
                        <Ionicons 
                          name={isSignUp ? "arrow-forward" : "log-in"} 
                          size={16} 
                          color="white" 
                        />
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>

            {/* Footer */}
            <View style={styles.footer}>
              <Ionicons name="wifi" size={12} color={COLORS.textMuted} />
              <Text style={styles.footerText}>
                Works offline via LAN or hotspot
              </Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { 
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  // Fixed header - height reduced to 130
  header: {
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 12 : 16,
    paddingBottom: 8,
    height: 130,
    justifyContent: 'flex-start',
  },
  logoContainer: { marginBottom: 4 },
  logoCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: 'rgba(0,0,0,0.3)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  title: {
    fontSize: 26,
    fontFamily: FONTS.black,
    fontWeight: '900',
    color: 'white',
    marginBottom: 2,
    letterSpacing: -1.5,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    fontFamily: FONTS.medium,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 16,
    paddingHorizontal: 10,
  },

  // Card wrapper - centers vertically but we add marginTop to card
  cardWrapper: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 4,
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 16,
    padding: 16,
    marginTop: 24, // <-- added to push card lower
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },

  // Tab Switcher
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 4,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 10,
  },
  activeTab: {
    backgroundColor: COLORS.purplePrimary,
    shadowColor: COLORS.purplePrimary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 2,
  },
  tabText: {
    fontSize: 13,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: '#6B7280',
  },
  activeTabText: { color: 'white' },

  // Error
  errorContainer: {
    backgroundColor: '#FEF2F2',
    padding: 8,
    borderRadius: 8,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: {
    color: '#DC2626',
    flex: 1,
    fontSize: 11,
    fontFamily: FONTS.medium,
  },

  // Inputs
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  inputIcon: { marginRight: 8 },
  input: {
    flex: 1,
    fontSize: 13,
    fontFamily: FONTS.regular,
    color: COLORS.inputText,
  },

  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: 12,
  },
  forgotPasswordText: {
    fontSize: 11,
    fontFamily: FONTS.medium,
    color: COLORS.purplePrimary,
    fontWeight: '600',
  },

  // Account type picker (Sign Up only)
  rolePicker: {
    marginBottom: 10,
  },
  rolePickerLabel: {
    fontSize: 11,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 6,
  },
  roleOptions: {
    flexDirection: 'row',
    gap: 8,
  },
  roleOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 9,
  },
  roleOptionActive: {
    backgroundColor: COLORS.purplePrimary,
    borderColor: COLORS.purplePrimary,
  },
  roleOptionText: {
    fontSize: 12,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: COLORS.purpleDeep,
  },
  roleOptionTextActive: {
    color: 'white',
  },

  // Submit
  submitButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 2,
  },
  submitButtonGradient: {
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  submitButtonText: {
    color: 'white',
    fontSize: 14,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
  submitButtonDisabled: { opacity: 0.7 },

  // Footer
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  footerText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontFamily: FONTS.medium,
  },
});