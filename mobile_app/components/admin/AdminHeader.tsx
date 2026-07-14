import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS } from '@/constants/adminTheme';

interface AdminHeaderProps {
  title: string;
  subtitle?: string;
  /** Pass true for Super Admin screens to render the dark "system-level" header */
  variant?: 'admin' | 'superadmin';
  /** Optional icon button on the right (e.g. add / filter) */
  rightIcon?: keyof typeof Ionicons.glyphMap;
  onRightPress?: () => void;
  /** Show back chevron (default true) */
  showBack?: boolean;
}

export default function AdminHeader({
  title,
  subtitle,
  variant = 'admin',
  rightIcon,
  onRightPress,
  showBack = true,
}: AdminHeaderProps) {
  const router = useRouter();
  const gradientColors: [string, string] =
    variant === 'superadmin'
      ? ['#0F172A', '#1E293B']
      : [COLORS.purpleDeep, COLORS.purpleDark];

  return (
    <LinearGradient
      colors={gradientColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.header}
    >
      <View style={styles.row}>
        {showBack ? (
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
        ) : (
          <View style={styles.iconBtn} />
        )}

        <View style={styles.titleWrap}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>

        {rightIcon ? (
          <TouchableOpacity style={styles.iconBtn} onPress={onRightPress} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name={rightIcon} size={22} color="#fff" />
          </TouchableOpacity>
        ) : (
          <View style={styles.iconBtn} />
        )}
      </View>

      {variant === 'superadmin' && (
        <View style={styles.devPill}>
          <Ionicons name="terminal-outline" size={12} color={COLORS.superAdminGlow} />
          <Text style={styles.devPillText}>DEVELOPER MODE</Text>
        </View>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingBottom: 20,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  titleWrap: { flex: 1, alignItems: 'center' },
  title: { color: '#fff', fontSize: 18, fontFamily: FONTS.extraBold, fontWeight: '800' },
  subtitle: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontFamily: FONTS.medium, marginTop: 2 },
  devPill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    backgroundColor: 'rgba(34,211,238,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.35)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  devPillText: { color: COLORS.superAdminGlow, fontSize: 10, fontFamily: FONTS.bold, letterSpacing: 1 },
});
