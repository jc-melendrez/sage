import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  formatMultiplier, nextMomentumTier,
  type PowerupKey, type PowerupPool, type TeamEntry,
} from '@/types/game';

const COLORS = {
  surface: '#1e1b4b',
  surfaceLight: '#2d2a5e',
  textPrimary: '#FFFFFF',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  warning: '#F59E0B',
};

const FONTS = {
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

export const POWERUP_META: Record<PowerupKey, { label: string; icon: keyof typeof Ionicons.glyphMap; tint: string }> = {
  freeze: { label: 'Freeze', icon: 'snow', tint: '#7DD3FC' },
  hint: { label: 'Hint', icon: 'bulb', tint: COLORS.warning },
  doublePoints: { label: '2x', icon: 'flash', tint: '#F472B6' },
  shield: { label: 'Shield', icon: 'shield-checkmark', tint: '#34D399' },
};

interface Props {
  team: TeamEntry;
  pool: PowerupPool;
  /** Which powerups the local player has armed for this answer. */
  active: Partial<Record<PowerupKey, boolean>>;
  /** Team mode only shows the pool; classic mode shows the personal one. */
  shared: boolean;
}

/**
 * The team momentum bar plus the shared powerup pool.
 *
 * The multiplier is the main read: it is the reason a wrong answer now costs
 * the whole team, so it needs to be visible at a glance from across a table
 * rather than buried in a scoreboard. The pool sits next to it because
 * "stacked on a team powerup" is a decision the player makes mid-question.
 */
export default function TeamMomentumHUD({ team, pool, active, shared }: Props) {
  const multiplier = team.multiplier ?? 1;
  const next = nextMomentumTier(team.teamCorrect ?? 0);
  const toNext = next ? Math.max(0, next.at - (team.teamCorrect ?? 0)) : 0;

  // Higher multiplier should feel better, so the bar brightens with the tier.
  const hot = multiplier >= 1.6;

  return (
    <View style={[styles.wrap, { borderColor: team.color + '55', backgroundColor: team.color + '14' }]}>
      <View style={styles.topRow}>
        <View style={[styles.nameWrap, { borderColor: team.color }]}>
          <View style={[styles.dot, { backgroundColor: team.color }]} />
          <Text style={[styles.name, { color: team.color }]} numberOfLines={1}>{team.name}</Text>
        </View>

        <View style={[styles.mult, hot && styles.multHot]}>
          <Text style={[styles.multText, hot && styles.multTextHot]}>
            {formatMultiplier(multiplier)}
          </Text>
        </View>
      </View>

      {/* momentum progress toward the next tier */}
      <View style={styles.momentumRow}>
        <View style={styles.momentumTrack}>
          <View
            style={[
              styles.momentumFill,
              {
                backgroundColor: team.color,
                width: `${Math.round((multiplier / 2) * 100)}%`,
              },
            ]}
          />
        </View>
        <Text style={styles.momentumText}>
          {hot ? '🔥 MAX MOMENTUM' : toNext > 0 ? `${toNext} more → ${formatMultiplier(next!.multiplier)}` : 'MAX'}
        </Text>
      </View>

      {/* shared pool */}
      <View style={styles.poolRow}>
        <View style={styles.poolLabel}>
          <Ionicons name={shared ? 'people' : 'person'} size={10} color={COLORS.textMuted} />
          <Text style={styles.poolLabelText}>{shared ? 'TEAM POOL' : 'YOUR POOL'}</Text>
        </View>
        <View style={styles.poolItems}>
          {(Object.keys(POWERUP_META) as PowerupKey[]).map(key => {
            const count = pool[key] ?? 0;
            const meta = POWERUP_META[key];
            const armed = active[key];
            return (
              <View
                key={key}
                style={[
                  styles.pill,
                  count > 0 && { borderColor: meta.tint + '88', backgroundColor: meta.tint + '1A' },
                  armed && { borderColor: meta.tint, backgroundColor: meta.tint + '33' },
                  count === 0 && styles.pillEmpty,
                ]}
              >
                <Ionicons name={meta.icon} size={11} color={count > 0 ? meta.tint : COLORS.textMuted} />
                <Text style={[styles.pillText, count > 0 && { color: meta.tint }]}>
                  {count > 0 ? `×${count}` : '0'}
                </Text>
                {armed && <View style={[styles.armedDot, { backgroundColor: meta.tint }]} />}
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 14, padding: 10, gap: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  nameWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    flex: 1, borderLeftWidth: 3, paddingLeft: 8,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  name: { fontSize: 13, fontFamily: FONTS.extraBold, flexShrink: 1 },

  mult: {
    paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)',
  },
  multHot: { backgroundColor: 'rgba(249,115,22,0.22)' },
  multText: { fontSize: 15, fontFamily: FONTS.extraBold, color: COLORS.textPrimary },
  multTextHot: { color: '#FDBA74' },

  momentumRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  momentumTrack: {
    flex: 1, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden',
  },
  momentumFill: { height: 4, borderRadius: 2 },
  momentumText: { fontSize: 9, fontFamily: FONTS.bold, color: COLORS.textMuted },

  poolRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  poolLabel: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  poolLabelText: { fontSize: 8, fontFamily: FONTS.extraBold, color: COLORS.textMuted, letterSpacing: 0.5 },
  poolItems: { flexDirection: 'row', gap: 4 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 7, paddingHorizontal: 5, paddingVertical: 2,
  },
  pillEmpty: { opacity: 0.45 },
  pillText: { fontSize: 9, fontFamily: FONTS.bold, color: COLORS.textMuted },
  armedDot: { width: 4, height: 4, borderRadius: 2 },
});
