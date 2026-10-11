/**
 * Actions for a flashcard deck shared in a group chat.
 *
 * Unlike a quiz, a deck has no server-side row to reference -- the whole deck
 * travels inside the message (`deck_embed`). So the only meaningful outcomes
 * are reading it here and taking a copy:
 *
 *   - Add to My Flashcards: import a private local deck the reader can study.
 *   - Preview cards: flip through the front/back of each card.
 *
 * The import is a full copy, so editing or deleting the reader's copy never
 * touches the sender's deck.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from '@/components/BottomSheet';
import { createDeck, addCardsBulk, initFlashcardDb } from '@/services/flashcardService';
import type { DeckEmbed } from '@/services/chatService';

const COLORS = {
  bg: '#F4F2FA',
  surface: '#FFFFFF',
  purplePrimary: '#7C3AED',
  purpleVibrant: '#8B5CF6',
  success: '#10B981',
  danger: '#EF4444',
  textPrimary: '#3a107a',
  textMuted: '#6B7280',
  border: 'rgba(124, 58, 237, 0.12)',
};

const FONTS = {
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

interface Props {
  visible: boolean;
  onClose: () => void;
  deck: DeckEmbed | null;
  /** Called after a successful import so the caller can refresh its deck list. */
  onImported?: (deckId: number) => void;
}

export default function DeckShareSheet({ visible, onClose, deck, onImported }: Props) {
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const handleImport = async () => {
    if (!deck) return;
    setBusy(true);
    try {
      initFlashcardDb();
      const created = createDeck(deck.title || 'Shared deck', {
        subject: deck.subject,
        color: deck.color || undefined,
      });
      const added = addCardsBulk(
        created.id,
        deck.cards.map((c) => ({ front: c.front, back: c.back, explanation: c.explanation })),
      );
      onImported?.(created.id);
      onClose();
      Alert.alert(
        'Added to My Flashcards',
        `"${deck.title}" was added with ${added} card${added === 1 ? '' : 's'}.`,
      );
    } catch (err: any) {
      Alert.alert('Import Failed', err?.message || 'Could not add this deck.');
    }
  };

  const subtitle = deck
    ? `${deck.card_count} ${deck.card_count === 1 ? 'card' : 'cards'}${deck.subject ? ` · ${deck.subject}` : ''}`
    : '';

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={deck?.title || 'Shared flashcards'}
      subtitle={subtitle}
    >
      {!deck ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>This deck is not available.</Text>
        </View>
      ) : showPreview ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.previewList}>
          {deck.cards.map((card, i) => (
            <View key={`${i}-${card.front.slice(0, 12)}`} style={styles.cardPreview}>
              <Text style={styles.cardIndex}>Card {i + 1}</Text>
              <Text style={styles.cardFront}>{card.front}</Text>
              <View style={styles.cardDivider} />
              <Text style={styles.cardBack}>{card.back}</Text>
              {card.explanation ? (
                <Text style={styles.cardExplanation}>{card.explanation}</Text>
              ) : null}
            </View>
          ))}
          <Pressable
            onPress={() => setShowPreview(false)}
            style={styles.secondaryBtn}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryBtnText}>Back to actions</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleImport}
            disabled={busy}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="add-circle-outline" size={19} color="#fff" />
                <Text style={styles.primaryBtnText}>Add to My Flashcards</Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={styles.actionsHint}>
            Saves a copy of every card into a new deck you can study and edit.
          </Text>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => setShowPreview(true)}
            accessibilityRole="button"
          >
            <Ionicons name="eye-outline" size={18} color={COLORS.purplePrimary} />
            <Text style={styles.secondaryBtnText}>Preview cards</Text>
          </TouchableOpacity>
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', paddingVertical: 40 },
  errorText: {
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  actions: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.purplePrimary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
  actionsHint: {
    fontSize: 11,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
    lineHeight: 16,
    marginBottom: 4,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 12,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: COLORS.purplePrimary,
  },
  previewList: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  cardPreview: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardIndex: {
    fontSize: 11,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
    color: COLORS.purpleVibrant,
  },
  cardFront: {
    fontSize: 14,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginTop: 4,
    lineHeight: 20,
  },
  cardDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 8,
  },
  cardBack: {
    fontSize: 13,
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary,
    lineHeight: 18,
  },
  cardExplanation: {
    fontSize: 12,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
    lineHeight: 17,
    marginTop: 8,
  },
});
