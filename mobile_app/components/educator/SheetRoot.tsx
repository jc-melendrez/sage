import React from 'react';
import { View, KeyboardAvoidingView, Platform, type StyleProp, type ViewStyle } from 'react-native';

export type SheetRootProps = {
  children: React.ReactNode;
  /** Overlay style — normally `{ flex: 1, justifyContent: 'flex-end' }` for a bottom sheet. */
  style?: StyleProp<ViewStyle>;
  /** Extra chrome height to leave above the keyboard on iOS (header, grabber, …). */
  keyboardVerticalOffset?: number;
};

/**
 * Layout root for educator bottom sheets and dialogs that contain inputs.
 *
 * iOS needs explicit keyboard avoidance. Android must NOT get a
 * KeyboardAvoidingView at all: with `behavior="height"` RN swaps the root to a
 * hard height + `flex: 0` while the keyboard is up, snaps it back to `flex: 1`
 * the instant the keyboard hides, and drives a global `LayoutAnimation` on the
 * way in — so the sheet judders up and down when dismissed. Android's default
 * `adjustResize` already keeps a bottom-anchored sheet above the keyboard.
 *
 * Pair this with `Keyboard.dismiss()` *before* flipping the modal's `visible`
 * prop, so the keyboard teardown doesn't race the exit animation, and avoid
 * clearing the form while `visible` is still true — reset on open instead.
 */
export function SheetRoot({ children, style, keyboardVerticalOffset }: SheetRootProps) {
  if (Platform.OS === 'ios') {
    return (
      <KeyboardAvoidingView
        style={style}
        behavior="padding"
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        {children}
      </KeyboardAvoidingView>
    );
  }
  return <View style={style}>{children}</View>;
}
