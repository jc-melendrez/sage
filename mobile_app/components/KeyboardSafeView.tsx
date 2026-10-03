/**
 * The app's single source of truth for keyboard avoidance.
 *
 * Why this exists: the app is edge-to-edge on Android
 * (`edgeToEdgeEnabled: true` in app.config.js), and edge-to-edge calls
 * `WindowCompat.setDecorFitsSystemWindows(window, false)`, which stops Android
 * resizing the window when the keyboard appears. So there is no built-in
 * resize to lean on and every screen has to pad itself -- but getting that
 * wrong is what made the UI jump up and then back down every time a textbox
 * gained focus.
 *
 * The old approach was a raw <KeyboardAvoidingView behavior="height"> on each
 * screen. That mode derives its offset from the window height *changing*,
 * which is exactly what edge-to-edge prevents, so it computed a wrong frame
 * and re-applied it on both the layout pass and `keyboardDidShow` -- hence the
 * double shift. A handful of other screens used `behavior={undefined}`, which
 * is no avoidance at all, and the chat screen hand-rolled a
 * `Keyboard.addListener` tracker that was the only one that actually worked.
 *
 * The fix has two halves, and both are required:
 *   1. `softwareKeyboardLayoutMode: 'adjustNothing'` in app.config.js, so the
 *      system never pans or resizes the window for the keyboard.
 *   2. This component, which is then the only thing that moves the layout.
 *
 * The two halves have to agree on who is responsible for the offset. The
 * manifest used to say 'pan', which asks Android to translate the window up to
 * reveal the focused input -- on top of the padding applied below. The two
 * compounded, so on every focus the content was pushed past the top of the
 * keyboard and left a blank strip above it. Anything that renders an input
 * therefore has to sit inside this component: with `adjustNothing` there is no
 * OS fallback revealing a field that nothing else has padded.
 *
 * The offset is driven by a Reanimated shared value so the movement happens on
 * the UI thread. Going through `useState` instead would re-render the whole
 * subtree on every show/hide, which is its own kind of jank on the heavier
 * screens (the AI assistant re-renders a long message list).
 *
 * One component covers both full screens and bottom sheets. Sheets are
 * `flex: 1, justifyContent: 'flex-end'`, so padding the container lifts the
 * sheet clear of the keyboard. Their `StyleSheet.absoluteFillObject` backdrop
 * gets clipped to the padding box, but that strip sits under the keyboard
 * anyway, so there is nothing to see.
 *
 * It also works inside a React Native <Modal>, which renders in its own native
 * window on Android -- `useSafeAreaInsets()` reports zero in there (see
 * ModalScreenHeader for the same problem) but the keyboard events still fire
 * and `endCoordinates.height` is still measured against the screen, so the
 * offset stays correct.
 */

import React, { useEffect, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

/**
 * Android's IME animation runs ~250ms. Matching it matters: `keyboardDidShow`
 * fires *after* the keyboard has finished sliding, so an instant jump would
 * leave a visible one-frame snap. Animating over the same window makes the
 * padding appear to move with the keyboard rather than after it.
 */
const KEYBOARD_ANIM_MS = 250;

export type KeyboardSafeViewProps = {
  children: ReactNode;
  /** The view's own layout style, e.g. `styles.container` or a `flex: 1` fill. */
  style?: StyleProp<ViewStyle>;
  /**
   * iOS only. Extra offset for views that sit above something the keyboard does
   * not cover on its own -- a tab bar, or a floating submit row. Ignored on
   * Android, where the measured keyboard height already includes those.
   */
  keyboardVerticalOffset?: number;
};

export function KeyboardSafeView({
  children,
  style,
  keyboardVerticalOffset = 0,
}: KeyboardSafeViewProps) {
  const keyboardHeight = useSharedValue(0);

  useEffect(() => {
    // iOS fires keyboardWill* and the <KeyboardAvoidingView> below already
    // handles it there, so tracking the height as well would double it.
    if (Platform.OS !== 'android') return;

    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      if (__DEV__) {
        // The single most useful number when a padded screen looks wrong. If
        // this is not the real keyboard height then every screen is off by
        // this much, and `adb shell dumpsys input_method` reports the same
        // number to compare against.
        console.log(`[KeyboardSafeView] keyboard height ${e.endCoordinates.height}px`);
      }
      keyboardHeight.value = withTiming(e.endCoordinates.height, {
        duration: KEYBOARD_ANIM_MS,
      });
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardHeight.value = withTiming(0, { duration: KEYBOARD_ANIM_MS });
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, [keyboardHeight]);

  // Stays at 0 on iOS, where the listener above never runs, so the animated
  // style is inert there.
  const animatedStyle = useAnimatedStyle(() => ({
    paddingBottom: keyboardHeight.value,
  }));

  // One view per platform, never nested. Each platform's view carries the
  // caller's own `style` directly, so the layout tree is byte-for-byte what it
  // was with a bare <KeyboardAvoidingView> -- only the padding source changes.
  //
  // Nesting an extra flex:1 wrapper in between would silently break the bottom
  // sheets: those containers are `flex: 1, justifyContent: 'flex-end'` and it
  // is that justifyContent which pins the sheet to the bottom. An inner wrapper
  // with default flex-start would move the sheet to the top of the modal.
  if (Platform.OS === 'android') {
    return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={keyboardVerticalOffset}
      style={style}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
