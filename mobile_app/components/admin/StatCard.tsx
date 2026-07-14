import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS } from '@/constants/adminTheme';

interface StatCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string | number;
  color?: string;
  trend?: string;
  trendUp?: boolean;
}

export default function StatCard({ icon, label, value, color = COLORS.purpleVibrant, trend, trendUp }: StatCardProps) {
  return (
    <View style={styles.card}>
      <View style={[styles.iconBg, { backgroundColor: `${color}22` }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
      {trend ? (
        <View style={styles.trendRow}>
          <Ionicons
            name={trendUp ? 'trending-up' : 'trending-down'}
            size={12}
            color={trendUp ? COLORS.success : COLORS.danger}
          />
          <Text style={[styles.trendText, { color: trendUp ? COLORS.success : COLORS.danger }]}>{trend}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  iconBg: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  value: { fontSize: 22, fontFamily: FONTS.black, fontWeight: '900', color: COLORS.textPrimary, letterSpacing: -0.5 },
  label: {
    fontSize: 11,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  trendRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  trendText: { fontSize: 11, fontFamily: FONTS.semiBold, fontWeight: '600' },
});
