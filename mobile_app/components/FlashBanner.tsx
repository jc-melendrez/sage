import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS } from '@/constants/gameTheme';

export type BannerType = 'error' | 'success' | 'info';

interface Props {
  visible: boolean;
  message: string;
  type?: BannerType;
  onHide: () => void;
}

const COLORS_BY_TYPE: Record<BannerType, string> = {
  error: COLORS.danger,
  success: COLORS.success,
  info: COLORS.accentBright,
};

const ICON_BY_TYPE: Record<BannerType, keyof typeof Ionicons.glyphMap> = {
  error: 'alert-circle',
  success: 'checkmark-circle',
  info: 'information-circle',
};

export default function FlashBanner({ visible, message, type = 'info', onHide }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (visible) {
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      hideTimer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => onHide());
      }, 2600);
    } else {
      opacity.setValue(0);
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [visible, message]);

  if (!visible) return null;

  const color = COLORS_BY_TYPE[type];

  return (
    <Animated.View style={[styles.wrap, { opacity }]}>
      <TouchableOpacity
        style={[styles.banner, { borderColor: color }]}
        activeOpacity={1}
        onPress={onHide}
      >
        <Ionicons name={ICON_BY_TYPE[type]} size={18} color={color} />
        <Text style={styles.text} numberOfLines={3}>{message}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    paddingHorizontal: 16,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  text: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 13,
    fontFamily: FONTS.semiBold,
  },
});
