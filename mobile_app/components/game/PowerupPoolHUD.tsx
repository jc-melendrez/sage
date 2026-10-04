import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type PowerupKey, type PowerupPool, type TeamEntry } from '@/types/game';

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
 * The powerup pool, shown above the question.
 *
 * This used to be the momentum bar with the pool tucked underneath it. The
 * multiplier is gone -- it compounded with the streak bonus and the doubled
 * questions, so a team that got hot early kept scoring well past the point it
 * stopped knowing the material (see the note in `types/game.ts`). What is left
 * is the pool, which is still worth showing plainly: arming a powerup is a
 * decision made mid-question, not a reward for having done well so far.
 */
export default function PowerupPoolHUD({ team, pool, active, shared }: Props) {
  return (
    <View style={[styles.wrap, { borderColor: team.color + '55', backgroundColor: team.color + '14' }]}>
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