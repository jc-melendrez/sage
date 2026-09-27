/**
 * Header row for a full-screen modal that must clear the system status bar.
 *
 * Why this exists: the app is edge-to-edge on Android
 * (`edgeToEdgeEnabled: true` in app.config.js), so content draws behind the
 * status bar and every screen has to pad itself out of the way. The screens
 * did that with hardcoded numbers, which were guesses -- `paddingTop: 8` on
 * the student quiz editor put the close and save buttons *under* the
 * notification bar on a real phone, and `Platform.OS === 'ios' ? 56 : 40` on
 * the educator one happened to clear a tall bar while clipping a short one.
 *
 * The non-obvious part is the SafeAreaProvider below. A React Native <Modal>
 * renders in its own native window, so on Android it sits outside the
 * provider that wraps the rest of the app and `useSafeAreaInsets()` there
 * returns 0. `initialWindowMetrics` hands the modal the real window insets
 * immediately, which is what react-native-safe-area-context documents for
 * exactly this case.
 *
 * Because the hook has to be read *inside* that boundary, this is a component
 * rather than a style: a caller cannot supply its own insets and get this
 * right by accident.
 */

import React from 'react';
import { View, Text, StyleSheet, type ViewStyle, type TextStyle } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
  initialWindowMetrics,
} from 'react-native-safe-area-context';

interface ModalScreenHeaderProps {
  /** Leading control, e.g. a close (X) or back (chevron) button. */
  left?: React.ReactNode;
  title?: string;
  /** Trailing control, e.g. a Save button. */
  right?: React.ReactNode;
  /** Gap between the status bar and the header content. */
  topSpacing?: number;
  horizontalPadding?: number;
  bottomPadding?: number;
  backgroundColor?: string;
  borderColor?: string;
  titleStyle?: TextStyle;
  /** Rendered under the title row, inside the same surface. */
  children?: React.ReactNode;
  style?: ViewStyle;
}

function HeaderInner({
  left,
  title,
  right,
  topSpacing = 14,
  horizontalPadding = 16,
  bottomPadding = 14,
  backgroundColor,
  borderColor,
  titleStyle,
  children,
  style,
}: ModalScreenHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.header,
        {
          // The whole point: measure the real status bar instead of guessing.
          paddingTop: insets.top + topSpacing,
          paddingHorizontal: horizontalPadding,
          paddingBottom: bottomPadding,
          backgroundColor,
          borderBottomColor: borderColor,
        },
        style,
      ]}
    >
      <View style={styles.row}>
        <View style={styles.side}>{left}</View>
        {title ? (
          <Text style={[styles.title, titleStyle]} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        <View style={[styles.side, styles.sideRight]}>{right}</View>
      </View>
      {children}
    </View>
  );
}

export default function ModalScreenHeader(props: ModalScreenHeaderProps) {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <HeaderInner {...props} />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  header: {
    borderBottomWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Equal-width sides keep the title optically centred when one side is an
  // icon and the other a wider button (e.g. Save).
  side: {
    minWidth: 44,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sideRight: {
    justifyContent: 'flex-end',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
  },
});
