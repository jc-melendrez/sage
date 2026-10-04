import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS } from '@/constants/educatorTheme';
import { useEducatorBack } from '@/hooks/useEducatorBack';
import { Avatar } from './EducatorPrimitives';

interface EducatorHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  /** Override the back action. Defaults to useEducatorBack(). */
  onBack?: () => void;
  /** Render the SAGE wordmark on the left of the icon row. */
  logo?: boolean;
  /**
   * Level the title with the icon buttons in the row above it instead of
   * stacking it below, so a title and its right-hand action share a baseline.
   */
  inlineTitle?: boolean;
  /**
   * Tighten the header's vertical padding. Only meaningful with inlineTitle,
   * where the title is no longer pushed down by the row's bottom margin.
   */
  compact?: boolean;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  onRightPress?: () => void;
  /**
   * A second icon rendered immediately left of `rightIcon`, sharing its button
   * style. `children` can't fill this slot because it renders below the row
   * rather than inside it, so a header that needs two actions beside each other
   * needs this instead. Pass `onSecondaryRightLongPress` to make the icon a
   * long-press-only action (React Native suppresses `onPress` once a long press
   * fires, so tap and hold can't both trigger).
   */
  secondaryRightIcon?: keyof typeof Ionicons.glyphMap;
  onSecondaryRightPress?: () => void;
  onSecondaryRightLongPress?: () => void;
  /** Spoken by screen readers in place of the icon name. */
  secondaryRightLabel?: string;
  secondaryRightHint?: string;
  /** Initials for a small avatar button rendered on the right. */
  avatar?: string;
  /** Resolved profile picture for that avatar, e.g. pfpSource(user.avatar). */
  avatarImage?: ImageSourcePropType | null;
  onAvatarPress?: () => void;
  /** Show a notification bell on the right. */
  showNotifications?: boolean;
  onNotificationsPress?: () => void;
  children?: React.ReactNode; // e.g. quick-stat pills or a class switcher
}

export function EducatorHeader({
  title,
  subtitle,
  showBack = false,
  onBack,
  logo = false,
  inlineTitle = false,
  compact = false,
  rightIcon,
  onRightPress,
  secondaryRightIcon,
  onSecondaryRightPress,
  onSecondaryRightLongPress,
  secondaryRightLabel,
  secondaryRightHint,
  avatar,
  avatarImage,
  onAvatarPress,
  showNotifications = false,
  onNotificationsPress,
  children,
}: EducatorHeaderProps) {
const goBack = useEducatorBack();
  // Real status-bar height. The gradient is meant to run under the bar
  // (edge-to-edge), so the controls need to sit below it.
  const insets = useSafeAreaInsets();

  return (
    <View>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.purpleDeep} translucent={false} />
      <LinearGradient
        colors={[COLORS.purpleDeep, COLORS.purpleDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
style={[styles.header, { paddingTop: insets.top + (compact ? 12 : 16) }]}
      >
        <View style={[styles.row, inlineTitle && styles.rowTight]}>
          {showBack && (
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={onBack ?? goBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="chevron-back" size={22} color="white" />
            </TouchableOpacity>
          )}
          {logo && (
            <View style={styles.logoContainer}>
              <Text style={styles.logoText}>SAGE</Text>
              <View style={styles.logoDot} />
            </View>
          )}
          {inlineTitle && (
            <Text style={[styles.title, styles.titleInline]} numberOfLines={1}>
              {title}
            </Text>
          )}
          <View style={{ flex: 1 }} />
          {showNotifications && (
            <TouchableOpacity
              style={[styles.iconBtn, styles.bellBtn]}
              onPress={onNotificationsPress}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
            >
              <Ionicons name="notifications-outline" size={20} color="white" />
            </TouchableOpacity>
          )}
          {secondaryRightIcon && (
            <TouchableOpacity
              style={[styles.iconBtn, styles.rightIconBtn]}
              onPress={onSecondaryRightPress}
              onLongPress={onSecondaryRightLongPress}
              accessibilityRole="button"
              accessibilityLabel={
                secondaryRightLabel ?? secondaryRightIcon.replace(/-outline$/, '').replace(/-/g, ' ')
              }
              accessibilityHint={secondaryRightHint}
            >
              <Ionicons name={secondaryRightIcon} size={20} color="white" />
            </TouchableOpacity>
          )}
          {rightIcon && (
            <TouchableOpacity
              style={[styles.iconBtn, styles.rightIconBtn]}
              onPress={onRightPress}
              accessibilityRole="button"
              accessibilityLabel={rightIcon.replace(/-outline$/, '').replace(/-/g, ' ')}
            >
              <Ionicons name={rightIcon} size={20} color="white" />
            </TouchableOpacity>
          )}
          {avatar && (
            <TouchableOpacity
              onPress={onAvatarPress}
              activeOpacity={0.85}
              style={styles.avatarWrap}
              accessibilityRole="button"
              accessibilityLabel="Your profile"
            >
              <Avatar initials={avatar} image={avatarImage} size={36} />
            </TouchableOpacity>
          )}
        </View>

        {!inlineTitle && <Text style={styles.title}>{title}</Text>}
        {subtitle && (
          <Text style={[styles.subtitle, inlineTitle && styles.subtitleBelowTitle]}>
            {subtitle}
          </Text>
        )}

        {children}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingBottom: 24,
    paddingHorizontal: 24,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  // The title sits in the row when inlineTitle is set, so it no longer needs
  // the 40/60 top padding plus the row's bottom margin above it.
  headerCompact: {
    paddingTop: 20,
    paddingBottom: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  rowTight: {
    marginBottom: 0,
  },

  // Mirrors the student dashboard wordmark (components/Dashboard.tsx:849-867):
  // a "SAGE" text with a green dot for a period. Same tokens on both sides, so
  // no new colors or fonts are introduced here.
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
  bellBtn: { marginLeft: 10 },
  rightIconBtn: { marginLeft: 10 },
  // Pinned to 36x36 so borderRadius is width/2 and the ring is a true circle;
  // without an explicit size the border pushes the box to 40x40 and radius 18
  // renders a rounded square. overflow:'hidden' clips the Avatar to the ring's
  // inner edge, which is what profile.tsx:83 and settings.tsx:107 both do.
  avatarWrap: {
    marginLeft: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
    overflow: 'hidden',
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 26,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: 'white',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  // flexShrink lets a long title ellipsize instead of pushing the right-hand
  // icon buttons off the header.
  titleInline: {
    marginBottom: 0,
    marginRight: 12,
    flexShrink: 1,
  },
  // With the title in the row, the row's marginBottom is gone, so the subtitle
  // carries the gap that used to separate them.
  subtitleBelowTitle: {
    marginTop: 6,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: FONTS.medium,
    // purplePale measured 3.85:1 on this gradient and failed WCAG 1.4.3 for
    // 14px text. purpleGhost clears 5:1 while staying in the same hue family.
    color: COLORS.purpleGhost,
  },
});
