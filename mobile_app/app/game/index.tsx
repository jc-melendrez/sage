import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// 🎨 Rich Purple Palette (matching Dashboard theme)
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
  
  textPrimary: '#3a107a',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  border: 'rgba(44, 29, 0, 0.15)',
};

// 🔠 Typography System
const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
};

export default function GameCenterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const gameModes = [
    {
      id: 'classic',
      title: 'Classic Battle',
      subtitle: 'Multiplayer Quiz',
      description: 'Host or join a room. Compete in real-time with friends and climb the leaderboard!',
      icon: 'trophy' as const,
      gradient: [COLORS.purpleDeep, COLORS.purpleDark] as [string, string],
      route: '/game/classic' as const,
      active: true,
      badge: 'LIVE',
      badgeColor: COLORS.success,
    },
    {
      id: 'time-attack',
      title: 'Time Attack',
      subtitle: 'Beat the Clock',
      description: 'Speed through AI-generated questions. How many can you get right in 60 seconds?',
      icon: 'timer' as const,
      gradient: [COLORS.danger, '#F87171'] as [string, string],
      active: false,
      badge: 'SOON',
      badgeColor: COLORS.warning,
    },
    {
      id: 'solo-practice',
      title: 'Solo Sprint',
      subtitle: 'Self-Paced',
      description: 'Practice questions on any topic at your own pace to master the material.',
      icon: 'person' as const,
      gradient: [COLORS.success, '#34D399'] as [string, string],
      active: false,
      badge: 'SOON',
      badgeColor: COLORS.warning,
    },
  ];

  return (
    <LinearGradient
      colors={[COLORS.bgSecondary, COLORS.bg]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.mainWrapper}
    >
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <View style={styles.container}>
        
        {/* 🌟 HEADER with Gradient – reduced top padding */}
        <LinearGradient
          colors={[COLORS.purpleDeep, COLORS.purpleDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.header, { paddingTop: insets.top + 12 }]} // ✅ reduced from +20 to +12
        >
          <View style={styles.headerContent}>
            <View style={styles.sectionTitleContainer}>
              <LinearGradient
                colors={[COLORS.warning, '#FBBF24']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.sectionIconBox}
              >
                <Ionicons name="game-controller" size={18} color="white" />
              </LinearGradient>
              <Text style={styles.title}>Game Center</Text>
            </View>
            
          </View>
        </LinearGradient>

        <ScrollView 
          contentContainerStyle={styles.scrollContent} 
          showsVerticalScrollIndicator={false}
        >
          {gameModes.map((mode, index) => (
            <TouchableOpacity
              key={mode.id}
              activeOpacity={0.7}
              style={[styles.card, !mode.active && styles.disabledCard]}
              onPress={() => mode.active && router.push(mode.route)}
              disabled={!mode.active}
            >
              {mode.active ? (
                <LinearGradient
                  colors={mode.gradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.cardGradient}
                >
                  <View style={styles.cardContent}>
                    <View style={styles.cardLeft}>
                      <View style={styles.iconWrapper}>
                        <Ionicons name={mode.icon} size={32} color="white" />
                      </View>
                    </View>
                    
                    <View style={styles.cardBody}>
                      <View style={styles.cardHeader}>
                        <Text style={styles.modeTitle}>{mode.title}</Text>
                        <View style={[styles.badge, { backgroundColor: `${mode.badgeColor}30` }]}>
                          <View style={[styles.badgeDot, { backgroundColor: mode.badgeColor }]} />
                          <Text style={[styles.badgeText, { color: mode.badgeColor }]}>
                            {mode.badge}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.modeSubtitle}>{mode.subtitle}</Text>
                      <Text style={styles.modeDescription} numberOfLines={2}>
                        {mode.description}
                      </Text>
                    </View>
                    
                    <View style={styles.cardRight}>
                      <Ionicons name="chevron-forward" size={24} color="rgba(255,255,255,0.6)" />
                    </View>
                  </View>
                </LinearGradient>
              ) : (
                <View style={styles.disabledCardContent}>
                  <View style={styles.cardLeft}>
                    <View style={[styles.iconWrapper, styles.disabledIconWrapper]}>
                      <Ionicons name={mode.icon} size={32} color={COLORS.textMuted} />
                    </View>
                  </View>
                  
                  <View style={styles.cardBody}>
                    <View style={styles.cardHeader}>
                      <Text style={[styles.modeTitle, styles.disabledTitle]}>{mode.title}</Text>
                      <View style={styles.lockBadge}>
                        <Ionicons name="lock-closed" size={10} color={COLORS.textMuted} />
                        <Text style={styles.lockText}>LOCKED</Text>
                      </View>
                    </View>
                    <Text style={[styles.modeSubtitle, styles.disabledSubtitle]}>{mode.subtitle}</Text>
                    <Text style={[styles.modeDescription, styles.disabledDescription]} numberOfLines={2}>
                      {mode.description}
                    </Text>
                  </View>
                  
                  <View style={styles.cardRight}>
                    <Text style={styles.comingSoonText}>SOON</Text>
                  </View>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  mainWrapper: { flex: 1 },
  container: { flex: 1 },
  
  // Header with Gradient
  header: {
    paddingHorizontal: 24,
    // paddingTop is now dynamic in the component
    paddingBottom: 32,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoText: {
    color: 'white',
    fontSize: 32,
    fontFamily: FONTS.black,
    fontWeight: '900',
    letterSpacing: -2,
  },
  logoDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.success,
    marginLeft: 4,
    marginTop: 8,
  },
  headerIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerContent: {},
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  sectionIconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontFamily: FONTS.extraBold,
    fontWeight: '900',
    color: 'white',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: FONTS.medium,
    color: 'rgba(255, 255, 255, 0.8)',
    marginLeft: 42,
  },
  
  scrollContent: {
    padding: 24,
    paddingTop: 24,
  },
  
  // Active Card with Gradient
  card: {
    borderRadius: 24,
    marginBottom: 20,
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
    overflow: 'hidden',
  },
  cardGradient: {
    borderRadius: 24,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
  },
  cardLeft: {
    marginRight: 16,
  },
  iconWrapper: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  cardBody: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  modeTitle: {
    fontSize: 20,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: 'white',
    flex: 1,
    marginRight: 8,
  },
  modeSubtitle: {
    fontSize: 11,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.7)',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  modeDescription: {
    fontSize: 13,
    fontFamily: FONTS.regular,
    color: 'rgba(255, 255, 255, 0.85)',
    lineHeight: 18,
  },
  cardRight: {
    marginLeft: 8,
  },
  
  // Badge
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 5,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 10,
    fontFamily: FONTS.black,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  
  // Disabled Card
  disabledCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    shadowOpacity: 0.1,
  },
  disabledCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
  },
  disabledIconWrapper: {
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(148, 163, 184, 0.2)',
  },
  disabledTitle: {
    color: COLORS.textMuted,
  },
  disabledSubtitle: {
    color: COLORS.textMuted,
  },
  disabledDescription: {
    color: COLORS.textMuted,
  },
  lockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  lockText: {
    fontSize: 9,
    fontFamily: FONTS.black,
    fontWeight: '900',
    color: COLORS.textMuted,
    letterSpacing: 0.3,
  },
  comingSoonText: {
    fontSize: 10,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textMuted,
    transform: [{ rotate: '90deg' }],
  },
});