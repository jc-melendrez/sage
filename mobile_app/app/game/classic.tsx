import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StatusBar
} from 'react-native';
import { useRouter } from 'expo-router';
import { getToken } from '@/services/authService';
import { API_BASE_URL } from '@/config/api';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

// 🎨 Unified Purple Palette (Dark Theme Variant)
const COLORS = {
  bg: '#0f0c29',
  bgSecondary: '#1a1640',
  surface: '#252158',
  surfaceLight: '#3a3570',
  
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
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  border: 'rgba(139, 92, 246, 0.2)',
};

const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
};

export default function ClassicGameSetupScreen() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState('');
  const [questionCount, setQuestionCount] = useState('5');
  const [timePerQuestion, setTimePerQuestion] = useState('15');
  const [questionType, setQuestionType] = useState<'mcq' | 'identification'>('mcq');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'home' | 'create' | 'join'>('home');
  const [selectedFile, setSelectedFile] = useState<{ name: string; uri: string; mimeType: string } | null>(null);

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'application/pdf'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        setSelectedFile({ name: file.name, uri: file.uri, mimeType: file.mimeType || 'application/octet-stream' });
      }
    } catch (err: any) {
      console.error('Document pick error:', err);
      Alert.alert('Error', err?.message || 'Failed to pick document');
    }
  };

  const handleCreate = async () => {
    if (!selectedFile) {
      Alert.alert('Error', 'Please upload a study material first');
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append('file', { uri: selectedFile.uri, name: selectedFile.name, type: selectedFile.mimeType } as any);
      formData.append('questionCount', questionCount);
      formData.append('timePerQuestion', timePerQuestion);
      formData.append('questionType', questionType);

      const response = await fetch(`${API_BASE_URL}/game/create/`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create room');
      router.push({ pathname: '/game/lobby', params: { roomCode: data.roomCode, isHost: 'true', topic: data.topic } });
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!joinCode.trim()) {
      Alert.alert('Error', 'Please enter a room code');
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/game/join/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ roomCode: joinCode.toUpperCase() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to join room');
      router.push({ pathname: '/game/lobby', params: { roomCode: joinCode.toUpperCase(), isHost: 'false', topic: data.topic } });
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  // Home Screen
  if (mode === 'home') {
    return (
      <LinearGradient
        colors={[COLORS.bg, COLORS.bgSecondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.container}
      >
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
        
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton} 
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={24} color={COLORS.purpleLight} />
            <Text style={styles.backButtonText}>Back to Hub</Text>
          </TouchableOpacity>
        </View>

        {/* Hero Section */}
        <View style={styles.heroSection}>
          <LinearGradient
            colors={[COLORS.purpleDeep, COLORS.purpleDark, COLORS.purplePrimary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroIconContainer}
          >
            <Ionicons name="trophy" size={48} color="white" />
          </LinearGradient>
          
          <Text style={styles.title}>Classic Quiz Battle</Text>
          <Text style={styles.subtitle}>Challenge friends in real-time multiplayer quizzes</Text>
        </View>

        {/* Action Cards */}
        <View style={styles.actionCards}>
          <TouchableOpacity 
            style={styles.actionCard} 
            onPress={() => setMode('create')}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={[COLORS.purplePrimary, COLORS.purpleVibrant]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.actionCardGradient}
            >
              <View style={styles.actionIconWrapper}>
                <Ionicons name="add-circle" size={24} color="white" />
              </View>
              <Text style={styles.actionTitle}>Create Room</Text>
              <Text style={styles.actionDescription}>Upload materials and host a quiz</Text>
              <View style={styles.actionArrow}>
                <Ionicons name="arrow-forward" size={16} color="white" />
              </View>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.actionCard} 
            onPress={() => setMode('join')}
            activeOpacity={0.8}
          >
            <View style={styles.actionCardOutline}>
              <View style={styles.actionIconWrapperOutline}>
                <Ionicons name="enter" size={24} color={COLORS.purpleVibrant} />
              </View>
              <Text style={styles.actionTitleOutline}>Join Room</Text>
              <Text style={styles.actionDescriptionOutline}>Enter a room code to compete</Text>
              <View style={styles.actionArrowOutline}>
                <Ionicons name="arrow-forward" size={16} color={COLORS.purpleVibrant} />
              </View>
            </View>
          </TouchableOpacity>
        </View>

        {/* Features */}
        <View style={styles.featuresSection}>
          <Text style={styles.featuresTitle}>Why Classic Mode?</Text>
          <View style={styles.featuresGrid}>
            <View style={styles.featureItem}>
              <Ionicons name="flash" size={20} color={COLORS.warning} />
              <Text style={styles.featureText}>Real-time battles</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="people" size={20} color={COLORS.accent} />
              <Text style={styles.featureText}>Multiplayer fun</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="document-text" size={20} color={COLORS.success} />
              <Text style={styles.featureText}>Custom content</Text>
            </View>
          </View>
        </View>
      </LinearGradient>
    );
  }

  // Create or Join Screen
  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <LinearGradient
        colors={[COLORS.bg, COLORS.bgSecondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.fullScreen}
      >
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
        
        <ScrollView 
          contentContainerStyle={styles.scrollContent} 
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.formHeader}>
            <TouchableOpacity 
              style={styles.backButtonSmall} 
              onPress={() => setMode('home')}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-back" size={18} color={COLORS.purpleLight} />
            </TouchableOpacity>
            <Text style={styles.formTitle}>
              {mode === 'create' ? 'Create Quiz Room' : 'Join Quiz Room'}
            </Text>
          </View>

          {mode === 'create' ? (
            <>
              {/* Upload Section */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepNumber}>1</Text>
                  </View>
                  <Text style={styles.sectionTitle}>Upload Study Material</Text>
                </View>
                
                <TouchableOpacity 
                  style={[
                    styles.uploadBox,
                    selectedFile && styles.uploadBoxSuccess
                  ]} 
                  onPress={pickDocument}
                  activeOpacity={0.7}
                >
                  {selectedFile ? (
                    <>
                      <LinearGradient
                        colors={[COLORS.success, '#34D399']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.uploadIconSuccess}
                      >
                        <Ionicons name="checkmark" size={22} color="white" />
                      </LinearGradient>
                      <Text style={styles.fileName}>{selectedFile.name}</Text>
                      <Text style={styles.changeFileText}>Tap to change file</Text>
                    </>
                  ) : (
                    <>
                      <LinearGradient
                        colors={[COLORS.purplePrimary, COLORS.purpleVibrant]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.uploadIcon}
                      >
                        <Ionicons name="cloud-upload" size={22} color="white" />
                      </LinearGradient>
                      <Text style={styles.uploadTitle}>Select File</Text>
                      <Text style={styles.uploadSubtitle}>Supports .txt and .pdf files</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              {/* Settings Section */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepNumber}>2</Text>
                  </View>
                  <Text style={styles.sectionTitle}>Quiz Settings</Text>
                </View>
                
                <View style={styles.settingsCard}>
                  <View style={styles.settingRow}>
                    <View style={styles.settingIconBox}>
                      <Ionicons name="list" size={16} color={COLORS.purpleVibrant} />
                    </View>
                    <View style={styles.settingContent}>
                      <Text style={styles.settingLabel}>Number of Questions</Text>
                      <TextInput 
                        style={styles.settingInput} 
                        value={questionCount} 
                        onChangeText={setQuestionCount} 
                        keyboardType="numeric"
                        placeholder="5"
                        placeholderTextColor={COLORS.textMuted}
                      />
                    </View>
                  </View>
                  
                  <View style={styles.settingDivider} />
                  
                  <View style={styles.settingRow}>
                    <View style={styles.settingIconBox}>
                      <Ionicons name="time" size={16} color={COLORS.purpleVibrant} />
                    </View>
                    <View style={styles.settingContent}>
                      <Text style={styles.settingLabel}>Time per Question (seconds)</Text>
                      <TextInput 
                        style={styles.settingInput} 
                        value={timePerQuestion} 
                        onChangeText={setTimePerQuestion} 
                        keyboardType="numeric"
                        placeholder="15"
                        placeholderTextColor={COLORS.textMuted}
                      />
                    </View>
                  </View>

                  <View style={styles.settingDivider} />

                  <View style={styles.settingRow}>
                    <View style={styles.settingIconBox}>
                      <Ionicons name="help-circle" size={16} color={COLORS.purpleVibrant} />
                    </View>
                    <View style={styles.settingContent}>
                      <Text style={styles.settingLabel}>Question Type</Text>
                      <View style={styles.typeToggle}>
                        <TouchableOpacity
                          style={[styles.typeOption, questionType === 'mcq' && styles.typeOptionActive]}
                          onPress={() => setQuestionType('mcq')}
                        >
                          <Text style={[styles.typeOptionText, questionType === 'mcq' && styles.typeOptionTextActive]}>
                            Multiple Choice
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.typeOption, questionType === 'identification' && styles.typeOptionActive]}
                          onPress={() => setQuestionType('identification')}
                        >
                          <Text style={[styles.typeOptionText, questionType === 'identification' && styles.typeOptionTextActive]}>
                            Identification
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </View>
              </View>

              {/* Create Button */}
              <TouchableOpacity 
                style={[
                  styles.primaryBtn,
                  (!selectedFile || loading) && styles.primaryBtnDisabled
                ]} 
                onPress={handleCreate} 
                disabled={loading || !selectedFile}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={(!selectedFile || loading) 
                    ? [COLORS.surfaceLight, COLORS.surface] 
                    : [COLORS.purplePrimary, COLORS.purpleVibrant]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.primaryBtnGradient}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="rocket" size={18} color="white" style={{ marginRight: 8 }} />
                      <Text style={styles.primaryBtnText}>Generate Room</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {/* Join Code Section */}
              <View style={styles.section}>
                <View style={styles.joinCodeCard}>
                  <View style={styles.joinCodeIcon}>
                    <Ionicons name="key" size={24} color={COLORS.purpleVibrant} />
                  </View>
                  <Text style={styles.joinCodeLabel}>Enter Room Code</Text>
                  <TextInput 
                    style={styles.joinCodeInput} 
                    placeholder="ABC123" 
                    value={joinCode} 
                    onChangeText={(text) => setJoinCode(text.toUpperCase())} 
                    autoCapitalize="characters"
                    maxLength={6}
                    placeholderTextColor={COLORS.textMuted}
                  />
                  <Text style={styles.joinCodeHint}>Ask your host for the 6-character code</Text>
                </View>
              </View>

              {/* Join Button */}
              <TouchableOpacity 
                style={[
                  styles.primaryBtn,
                  (!joinCode.trim() || loading) && styles.primaryBtnDisabled
                ]} 
                onPress={handleJoin} 
                disabled={loading || !joinCode.trim()}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={(!joinCode.trim() || loading) 
                    ? [COLORS.surfaceLight, COLORS.surface] 
                    : [COLORS.purplePrimary, COLORS.purpleVibrant]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.primaryBtnGradient}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="enter" size={18} color="white" style={{ marginRight: 8 }} />
                      <Text style={styles.primaryBtnText}>Join Room</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1,
  },
  fullScreen: {
    flex: 1,
  },
  
  // Header
  header: {
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backButtonText: {
    color: COLORS.purpleLight,
    fontSize: 14,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
  },
  
  // Hero Section
  heroSection: {
    alignItems: 'center',
    paddingHorizontal: 24,
    marginTop: 16,
    marginBottom: 28,
  },
  heroIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  title: {
    fontSize: 28,
    fontFamily: FONTS.black,
    fontWeight: '900',
    color: COLORS.textPrimary,
    marginBottom: 4,
    letterSpacing: -1,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    fontFamily: FONTS.regular,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  
  // Action Cards
  actionCards: {
    paddingHorizontal: 24,
    gap: 12,
    marginBottom: 28,
  },
  actionCard: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  actionCardGradient: {
    padding: 18,
    minHeight: 110,
    justifyContent: 'space-between',
  },
  actionCardOutline: {
    padding: 18,
    minHeight: 110,
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'space-between',
  },
  actionIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  actionIconWrapperOutline: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  actionTitle: {
    fontSize: 18,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: 'white',
    marginBottom: 2,
  },
  actionTitleOutline: {
    fontSize: 18,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  actionDescription: {
    fontSize: 12,
    fontFamily: FONTS.regular,
    color: 'rgba(255, 255, 255, 0.85)',
    lineHeight: 18,
  },
  actionDescriptionOutline: {
    fontSize: 12,
    fontFamily: FONTS.regular,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  actionArrow: {
    alignSelf: 'flex-end',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionArrowOutline: {
    alignSelf: 'flex-end',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Features
  featuresSection: {
    paddingHorizontal: 24,
  },
  featuresTitle: {
    fontSize: 14,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 12,
    textAlign: 'center',
  },
  featuresGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  featureItem: {
    alignItems: 'center',
    gap: 4,
  },
  featureText: {
    fontSize: 11,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  
  // Form Header
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 20,
    gap: 12,
  },
  backButtonSmall: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  formTitle: {
    fontSize: 22,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textPrimary,
    flex: 1,
  },
  
  // Scroll Content
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  
  // Sections
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.purplePrimary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNumber: {
    color: 'white',
    fontSize: 12,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: FONTS.extraBold,
    fontWeight: '900',
    color: COLORS.textPrimary,
    letterSpacing: 0.5,
  },
  
  // Upload Box
  uploadBox: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  uploadBoxSuccess: {
    borderColor: COLORS.success,
    borderStyle: 'solid',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  uploadIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  uploadIconSuccess: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  uploadTitle: {
    fontSize: 16,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  uploadSubtitle: {
    fontSize: 12,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
  },
  fileName: {
    fontSize: 14,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: COLORS.success,
    marginBottom: 2,
    textAlign: 'center',
  },
  changeFileText: {
    fontSize: 12,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
  },
  
  // Settings Card
  settingsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingContent: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 12,
    fontFamily: FONTS.medium,
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  settingInput: {
    fontSize: 16,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textPrimary,
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 10,
    padding: 10,
  },
  settingDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 12,
  },
  typeToggle: { flexDirection: 'row', gap: 8, marginTop: 6 },
  typeOption: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  typeOptionActive: { backgroundColor: COLORS.purplePrimary, borderColor: COLORS.purplePrimary },
  typeOptionText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  typeOptionTextActive: { color: '#fff' },
  
  // Join Code Card
  joinCodeCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  joinCodeIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  joinCodeLabel: {
    fontSize: 14,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  joinCodeInput: {
    width: '100%',
    fontSize: 22,
    fontFamily: FONTS.black,
    fontWeight: '900',
    color: COLORS.textPrimary,
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 12,
    padding: 14,
    textAlign: 'center',
    letterSpacing: 4,
    marginBottom: 8,
  },
  joinCodeHint: {
    fontSize: 12,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  
  // Primary Button
  primaryBtn: {
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 12,
  },
  primaryBtnGradient: {
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryBtnText: {
    color: 'white',
    fontSize: 16,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
  primaryBtnDisabled: {
    opacity: 0.5,
  },
});