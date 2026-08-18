import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  StatusBar,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { getLeaderboard, LeaderboardEntry } from '@/services/gamificationService';
import { getCurrentUser } from '@/services/authService';

const COLORS = {
  bg: '#baaeda',
  bgSecondary: '#dad6e7',
  surface: '#cdc2dd',
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
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  border: 'rgba(44, 29, 0, 0.15)',
};

const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
};

const MEDALS = ['🥇', '🥈', '🥉'];

export default function LeaderboardScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [yourRank, setYourRank] = useState<number | null>(null);
  const [yourPoints, setYourPoints] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLeaderboard = useCallback(async () => {
    try {
      setError(null);
      const user = await getCurrentUser();
      setCurrentUserId(user?.id ?? null);
      const data = await getLeaderboard();
      setEntries(data.entries);
      setYourRank(data.your_rank);
      setYourPoints(data.your_points);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadLeaderboard();
    }, [loadLeaderboard]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadLeaderboard();
  }, [loadLeaderboard]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.purpleDeep} />

      <LinearGradient
        colors={[COLORS.purpleDeep, COLORS.purpleDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={22} color="white" />
          </TouchableOpacity>
          <View style={styles.headerTitleBox}>
            <Text style={styles.headerTitle}>Leaderboard</Text>
            <Text style={styles.headerSubtitle}>Top students by total points</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.purplePrimary} />
        }
      >
        {/* Your rank card */}
        <LinearGradient
          colors={[COLORS.purplePrimary, COLORS.purpleVibrant]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.youCard}
        >
          <View style={styles.youCardIcon}>
            <Ionicons name="podium" size={26} color="white" />
          </View>
          <View style={styles.youCardText}>
            <Text style={styles.youCardLabel}>Your Rank</Text>
            <Text style={styles.youCardValue}>
              {yourRank === null ? '—' : `#${yourRank}`}
            </Text>
          </View>
          <View style={styles.youCardRight}>
            <Text style={styles.youCardPointsLabel}>Points</Text>
            <Text style={styles.youCardPoints}>{yourPoints.toLocaleString()}</Text>
          </View>
        </LinearGradient>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Top 20</Text>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={COLORS.purpleVibrant} style={{ marginTop: 40 }} />
        ) : error ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={40} color={COLORS.danger} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={loadLeaderboard} activeOpacity={0.8}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.listCard}>
            {entries.map((entry, idx) => {
              const isYou = entry.id === currentUserId || entry.is_you;
              return (
                <View
                  key={String(entry.id)}
                  style={[
                    styles.rankRow,
                    idx > 0 && styles.borderTop,
                    isYou && styles.rankRowYou,
                  ]}
                >
                  <View style={styles.rankBadgeWrap}>
                    {idx < 3 ? (
                      <Text style={styles.medal}>{MEDALS[idx]}</Text>
                    ) : (
                      <View style={[styles.rankBadge, { backgroundColor: 'rgba(124,58,237,0.12)' }]}>
                        <Text style={styles.rankNumber}>{entry.rank}</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.rankInfo}>
                    <Text style={[styles.rankName, isYou && styles.rankNameYou]} numberOfLines={1}>
                      {entry.display_name}
                      {isYou && <Text style={styles.youTag}> (You)</Text>}
                    </Text>
                    <Text style={styles.rankMeta}>Lv {entry.level}{entry.streak > 0 ? ` · 🔥${entry.streak}` : ''}</Text>
                  </View>
                  <Text style={styles.rankPoints}>{entry.total_points.toLocaleString()} pts</Text>
                </View>
              );
            })}
            {entries.length === 0 && (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No students on the leaderboard yet.</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 24,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center' },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerTitleBox: { flex: 1 },
  headerTitle: {
    color: 'white',
    fontSize: 26,
    fontFamily: FONTS.black,
    letterSpacing: -1,
  },
  headerSubtitle: {
    color: COLORS.purplePale,
    fontSize: 13,
    fontFamily: FONTS.medium,
    marginTop: 2,
  },
  headerSpacer: { width: 40 },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },

  youCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  youCardIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  youCardText: { flex: 1 },
  youCardLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontFamily: FONTS.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  youCardValue: {
    color: 'white',
    fontSize: 28,
    fontFamily: FONTS.black,
    marginTop: 2,
  },
  youCardRight: { alignItems: 'flex-end' },
  youCardPointsLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontFamily: FONTS.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  youCardPoints: {
    color: '#FDE68A',
    fontSize: 20,
    fontFamily: FONTS.extraBold,
    marginTop: 2,
  },

  sectionHeader: { marginBottom: 12 },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontFamily: FONTS.extraBold,
    letterSpacing: 1,
  },

  listCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  borderTop: { borderTopWidth: 1, borderTopColor: COLORS.border },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  rankRowYou: {
    backgroundColor: 'rgba(34,211,238,0.08)',
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  rankBadgeWrap: { width: 36, alignItems: 'center' },
  medal: { fontSize: 22 },
  rankBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankNumber: { fontSize: 13, fontFamily: FONTS.black, color: COLORS.purpleDark },
  rankInfo: { flex: 1 },
  rankName: {
    fontSize: 14.5,
    fontFamily: FONTS.semiBold,
    color: COLORS.textPrimary,
  },
  rankNameYou: { color: '#0E7490', fontFamily: FONTS.extraBold },
  youTag: { fontSize: 12, fontFamily: FONTS.extraBold, color: '#0E7490' },
  rankMeta: { fontSize: 11.5, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },
  rankPoints: {
    fontSize: 14,
    fontFamily: FONTS.bold,
    color: COLORS.purpleDark,
  },

  errorCard: { alignItems: 'center', paddingVertical: 40 },
  errorText: {
    color: COLORS.danger,
    fontSize: 14,
    fontFamily: FONTS.medium,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  retryBtn: {
    backgroundColor: COLORS.purplePrimary,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 28,
  },
  retryBtnText: { color: 'white', fontSize: 14, fontFamily: FONTS.bold },
  emptyCard: { padding: 30, alignItems: 'center' },
  emptyText: { color: COLORS.textMuted, fontSize: 13, fontFamily: FONTS.medium },
});
