import { View, Text, StyleSheet } from 'react-native';
import { COLORS, STATUS_COLORS, FONTS } from '@/constants/adminTheme';

export default function StatusPill({ status }: { status: string }) {
  const color = STATUS_COLORS[status.toLowerCase()] || COLORS.textMuted;
  return (
    <View style={[styles.pill, { backgroundColor: `${color}1F`, borderColor: `${color}55` }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, { color }]}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 11, fontFamily: FONTS.semiBold, fontWeight: '600', textTransform: 'capitalize' },
});
