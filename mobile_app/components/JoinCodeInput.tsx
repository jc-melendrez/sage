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
 * hold its own character and backspace always moves backwards one box.
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
    // Android can deliver the whole replacement string ("7") rather than a
    // single keystroke, so take the last character and treat anything with
    // more than one as a paste into the current slot.
    const char = text.replace(/[^a-zA-Z0-9]/g, '').slice(-1).toUpperCase();
    const next = [...slots];

    if (!char) {
      next[index] = '';
      onChange(next);
      focusSlot(index - 1);
      return;
    }

    next[index] = char;
    onChange(next);
    if (index < JOIN_CODE_LENGTH - 1) focusSlot(index + 1);
  };

  const handleKeyPress = (event: any, index: number) => {
    if (event.nativeEvent.key !== 'Backspace') return;
    // Only act when this box is already empty, so a normal backspace on a
    // filled box still clears that one box through onChangeText.
    if (slots[index]) return;
    if (index === 0) return;
    const next = [...slots];
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
          maxLength={1}
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
