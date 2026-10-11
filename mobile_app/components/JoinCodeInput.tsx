/**
 * Fixed-slot join code input.
 *
 * This exists because four screens had grown their own copy of the same
 * 6-box code entry, and every copy shared two bugs:
 *
 *  1. State was a single compact string, so filling slot 3 then slot 0
 *     shifted the earlier character left instead of replacing slot 0.
 *  2. Backspace on an already-empty slot spliced characters out of the
 *     joined string, so pressing backspace repeatedly deleted digits the
 *     user was not looking at.
 *
 * Here the state is an array with one entry per box, so a slot can only ever
 * hold its own character.
 *
 * Backspace navigation lives in onKeyPress alone. An earlier version also
 * moved focus backwards from onChangeText whenever a box reported empty text,
 * which fought with onKeyPress: on Android the two fire for the same keypress,
 * so a single backspace could run the "clear the previous box" step twice and
 * drag focus two boxes left, leaving the user pressing backspace at a slot they
 * had not typed into. onChangeText now only ever writes the current slot.
 *
 * A pasted code used to die on the `maxLength={1}` of whichever box had focus:
 * the field kept one character and `.slice(-1)` threw away the rest, so a
 * six-character code arrived as a single letter. There is no maxLength now;
 * the handler tells a one-character replacement (keystroke) from a multi-
 * character one (paste) and distributes the latter across the boxes from the
 * slot the user was in, landing focus on the first box still empty.
 */

import React, { useRef } from 'react';
import { TextInput, View, StyleSheet } from 'react-native';

export const JOIN_CODE_LENGTH = 6;

export function joinCodeToString(slots: string[]): string {
  return slots.join('').trim().toUpperCase();
}

export function isJoinCodeComplete(slots: string[]): boolean {
  return slots.filter(Boolean).length === JOIN_CODE_LENGTH;
}

interface Props {
  slots: string[];
  onChange: (slots: string[]) => void;
  editable?: boolean;
  /** Style overrides so each screen keeps its own visual language. */
  containerStyle?: object;
  boxStyle?: object;
  filledBoxStyle?: object;
  accessibilityLabel?: string;
}

export default function JoinCodeInput({
  slots,
  onChange,
  editable = true,
  containerStyle,
  boxStyle,
  filledBoxStyle,
  accessibilityLabel = 'Join code',
}: Props) {
  const refs = useRef<(TextInput | null)[]>([]);

  const focusSlot = (index: number) => {
    if (index < 0 || index >= JOIN_CODE_LENGTH) return;
    refs.current[index]?.focus();
  };

  const handleChangeText = (text: string, index: number) => {
    // Android can deliver the whole replacement string rather than a single
    // keystroke, so strip everything that is not letters/digits and then tell a
    // one-character replacement from a multi-character paste.
    const chars = text.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().split('');
    const next = [...slots];

    if (chars.length === 0) {
      // The slot was cleared (backspace, or the user selected its character
      // and deleted it). Just empty this slot -- deliberately no focus change,
      // because backspace navigation is owned by handleKeyPress below.
      next[index] = '';
      onChange(next);
      return;
    }

    if (chars.length === 1) {
      // Ordinary keystroke (or a one-character replacement): write this slot.
      next[index] = chars[0];
      onChange(next);
      if (index < JOIN_CODE_LENGTH - 1) focusSlot(index + 1);
      return;
    }

    // A pasted code. `maxLength={1}` used to truncate this to a single
    // character and `.slice(-1)` kept only the last one, so pasting a full
    // code entered one letter. Distribute the characters across the boxes
    // starting at the slot the user was in (overwriting anything there), then
    // land on the first box still empty so they can add any missing digits.
    let i = 0;
    while (i < chars.length && index + i < JOIN_CODE_LENGTH) {
      next[index + i] = chars[i];
      i += 1;
    }
    onChange(next);
    let focus = index + i;
    while (focus < JOIN_CODE_LENGTH && next[focus]) focus += 1;
    focusSlot(focus >= JOIN_CODE_LENGTH ? JOIN_CODE_LENGTH - 1 : focus);
  };

  const handleKeyPress = (event: any, index: number) => {
    if (event.nativeEvent.key !== 'Backspace') return;
    const next = [...slots];
    // Filled box: clear it and stay put, which is what the user sees happen.
    if (slots[index]) {
      next[index] = '';
      onChange(next);
      return;
    }
    // Empty box: eat the character to the left and follow it there, so
    // repeated presses walk backwards one box at a time.
    if (index === 0) return;
    next[index - 1] = '';
    onChange(next);
    focusSlot(index - 1);
  };

  return (
    <View style={[styles.row, containerStyle]} accessibilityLabel={accessibilityLabel}>
      {Array.from({ length: JOIN_CODE_LENGTH }).map((_, index) => (
        <TextInput
          key={index}
          ref={(ref) => {
            refs.current[index] = ref;
          }}
          style={[styles.box, boxStyle, slots[index] ? filledBoxStyle : null]}
          value={slots[index] || ''}
          onChangeText={(text) => handleChangeText(text, index)}
          onKeyPress={(event) => handleKeyPress(event, index)}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect={false}
          spellCheck={false}
          textContentType="oneTimeCode"
          editable={editable}
          selectTextOnFocus
          accessibilityLabel={`${accessibilityLabel} character ${index + 1} of ${JOIN_CODE_LENGTH}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  box: {
    width: 44,
    height: 56,
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '700',
    borderWidth: 1,
  },
});
