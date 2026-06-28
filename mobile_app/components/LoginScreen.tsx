import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import firestore from '@react-native-firebase/firestore';

export default function LoginScreen() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [showAITip, setShowAITip] = useState(true);
  const router = useRouter();
  const { login, register, loading, error, clearError } = useAuth();

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState(''); // Only used for Sign Up

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    try {
      clearError();
      // Pass email as the first argument for Firebase Auth
      await login({ username: email, password: password });
      router.replace('/');
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
      await register({
        username,
        email,
        password,
        first_name: firstName,
        last_name: lastName,
        is_student: true,
      });
      router.replace('/');
    } catch (err) {
      Alert.alert('Sign Up Failed', error || 'Please try again');
    }
  };

  return (
    <LinearGradient colors={['#7C3AED', '#8B5CF6', '#4F46E5']} style={styles.container}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content}>
          {/* Logo */}
          <View style={styles.logoContainer}>
            <View style={styles.logoCircle}>
              <Ionicons name="sparkles-outline" size={40} color="#7C3AED" />
            </View>
            <Text style={styles.title}>SAGE</Text>
            <Text style={styles.subtitle}> Smart Assistant for Group-Based Education </Text>
          </View>

          {/* AI Tip */}
          {showAITip && (
            <View style={styles.aiCard}>
              <View style={styles.aiRow}>
                <View style={styles.aiIcon}>
                  <Ionicons name="sparkles-outline" size={16} color="#3B0764" />
                </View>
                <Text style={styles.aiText}>
                  {isSignUp ? 'Create a new account to join SAGE' : 'Welcome! Sign in to continue.'}
                </Text>
                <TouchableOpacity onPress={() => setShowAITip(false)}>
                  <Text style={styles.closeText}>×</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Form Card */}
          <View style={styles.card}>
            <Text style={styles.heading}>
              {isSignUp ? 'Create Account' : 'Welcome Back'}
            </Text>

            {/* Error message */}
            {error && (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={16} color="#EF4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {isSignUp && (
              <>
                <View style={styles.inputContainer}>
                  <Ionicons name="person-outline" size={18} color="#9CA3AF" />
                  <TextInput placeholder="First Name" style={styles.input} value={firstName} onChangeText={setFirstName} editable={!loading} />
                </View>
                <View style={styles.inputContainer}>
                  <Ionicons name="person-outline" size={18} color="#9CA3AF" />
                  <TextInput placeholder="Last Name" style={styles.input} value={lastName} onChangeText={setLastName} editable={!loading} />
                </View>
                <View style={styles.inputContainer}>
                  <Ionicons name="at-outline" size={18} color="#9CA3AF" />
                  <TextInput placeholder="Choose a Username" style={styles.input} value={username} onChangeText={setUsername} editable={!loading} />
                </View>
              </>
            )}

            <View style={styles.inputContainer}>
              <Ionicons name="mail-outline" size={18} color="#9CA3AF" />
              <TextInput 
                placeholder="Email Address" 
                keyboardType="email-address" 
                autoCapitalize="none"
                style={styles.input} 
                value={email} 
                onChangeText={setEmail} 
                editable={!loading} 
              />
            </View>

            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={18} color="#9CA3AF" />
              <TextInput placeholder="Password" secureTextEntry style={styles.input} value={password} onChangeText={setPassword} editable={!loading} />
            </View>

            <TouchableOpacity 
              style={[styles.loginButton, loading && styles.loginButtonDisabled]} 
              onPress={isSignUp ? handleSignUp : handleLogin} 
              disabled={loading} 
            >
              {loading ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <Text style={styles.loginButtonText}>
                  {isSignUp ? 'Sign Up' : 'Log In'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setIsSignUp(!isSignUp)} disabled={loading}>
              <Text style={[styles.toggleText, loading && { opacity: 0.5 }]}>
                {isSignUp ? 'Already have an account? Log In' : "Don't have an account? Sign Up"}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.footer}> Works offline via LAN or hotspot </Text>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, justifyContent: 'center' },
  logoContainer: { alignItems: 'center', marginBottom: 24 },
  logoCircle: { backgroundColor: 'white', padding: 16, borderRadius: 50, marginBottom: 12, },
  title: { fontSize: 32, color: 'white', fontWeight: 'bold' },
  subtitle: { color: '#E9D5FF', textAlign: 'center', marginTop: 4, },
  aiCard: { backgroundColor: 'rgba(255,255,255,0.15)', padding: 12, borderRadius: 12, marginBottom: 20, },
  aiRow: { flexDirection: 'row', alignItems: 'center' },
  aiIcon: { backgroundColor: '#FACC15', padding: 6, borderRadius: 20, marginRight: 8, },
  aiText: { flex: 1, color: 'white', fontSize: 13 },
  closeText: { color: 'white', fontSize: 18, marginLeft: 8 },
  card: { backgroundColor: 'white', padding: 20, borderRadius: 16, },
  heading: { fontSize: 22, textAlign: 'center', marginBottom: 16, fontWeight: '600', },
  errorContainer: { backgroundColor: '#FEE2E2', padding: 12, borderRadius: 8, marginBottom: 12, flexDirection: 'row', alignItems: 'center', },
  errorText: { color: '#DC2626', marginLeft: 8, flex: 1, fontSize: 13, },
  inputContainer: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 12, },
  input: { flex: 1, marginLeft: 8 },
  loginButton: { backgroundColor: '#7C3AED', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 10, },
  loginButtonDisabled: { opacity: 0.6, },
  loginButtonText: { color: 'white', fontWeight: '600' },
  toggleText: { textAlign: 'center', marginTop: 14, color: '#7C3AED', },
  footer: { textAlign: 'center', color: 'rgba(255,255,255,0.8)', marginTop: 20, fontSize: 12, },
});