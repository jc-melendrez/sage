import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function GamesScreen() {
  const router = useRouter();

  // Define game modes - currently only Classic is active
  const gameModes = [
    {
      id: 'classic',
      title: 'Classic Battle',
      subtitle: 'Multiplayer Quiz',
      description: 'Host or join a room. Compete in real-time with friends and climb the leaderboard!',
      icon: 'trophy' as const,
      color: '#7F77DD', // Matching your primary purple theme
      route: '/game' as const,
      active: true,
    },
    {
      id: 'time-attack',
      title: 'Time Attack',
      subtitle: 'Beat the Clock',
      description: 'Speed through AI-generated questions. How many can you get right in 60 seconds?',
      icon: 'timer' as const,
      color: '#D4537E',
      active: false,
    },
    {
      id: 'solo-practice',
      title: 'Solo Sprint',
      subtitle: 'Self-Paced',
      description: 'Practice questions on any topic at your own pace to master the material.',
      icon: 'person' as const,
      color: '#1D9E75',
      active: false,
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Game Center</Text>
        <Text style={styles.subtitle}>Select a mode to start earning XP</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {gameModes.map((mode) => (
          <TouchableOpacity
            key={mode.id}
            activeOpacity={0.7}
            style={[styles.card, !mode.active && styles.disabledCard]}
            onPress={() => mode.active && router.push(mode.route)}
            disabled={!mode.active}
          >
            <View style={[styles.iconWrapper, { backgroundColor: mode.color }]}>
              <Ionicons name={mode.icon} size={28} color="white" />
            </View>

            <View style={styles.cardBody}>
              <View style={styles.cardHeader}>
                <Text style={styles.modeTitle}>{mode.title}</Text>
                {!mode.active && (
                  <View style={styles.lockBadge}>
                    <Ionicons name="lock-closed" size={10} color="#6B7280" />
                    <Text style={styles.lockText}>LOCKED</Text>
                  </View>
                )}
              </View>
              <Text style={styles.modeSubtitle}>{mode.subtitle}</Text>
              <Text style={styles.modeDescription} numberOfLines={2}>
                {mode.description}
              </Text>
            </View>

            {mode.active ? (
              <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
            ) : (
              <Text style={styles.comingSoonText}>SOON</Text>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 4,
  },
  scrollContent: {
    padding: 20,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 24,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  disabledCard: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  iconWrapper: {
    width: 56,
    height: 56,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardBody: {
    flex: 1,
    marginLeft: 16,
    marginRight: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modeTitle: { fontSize: 18, fontWeight: '700', color: '#1F2937' },
  modeSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6D28D9',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  modeDescription: { fontSize: 14, color: '#6B7280', lineHeight: 18 },
  lockBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E5E7EB', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  lockText: { fontSize: 9, fontWeight: '800', color: '#6B7280', marginLeft: 2 },
  comingSoonText: { fontSize: 10, fontWeight: 'bold', color: '#9CA3AF', transform: [{ rotate: '90deg' }] },
});