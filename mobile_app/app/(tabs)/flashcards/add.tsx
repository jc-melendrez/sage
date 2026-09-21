import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  TextInput,
  Modal,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, GRADIENT_COLORS, PURPLE_HEADER_GRADIENT } from '@/constants/gameTheme';
import FlashBanner, { BannerType } from '@/components/FlashBanner';
import {
  Card,
  Deck,
  initFlashcardDb,
  getDeck,
  getCards,
  addCard,
  addCardsBulk,
  parseBulkInput,
  CardEntryInput,
} from '@/services/flashcardService';

export default function AddCardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ deckId: string }>();
  const deckId = Number(params.deckId);

  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);

  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [explanation, setExplanation] = useState('');
  const backRef = React.useRef<TextInput>(null);

  const [recent, setRecent] = useState<number>(0);

  const [importOpen, setImportOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [parsed, setParsed] = useState<CardEntryInput[]>([]);

  const [banner, setBanner] = useState<{ message: string; type: BannerType } | null>(null);

  const loadCards = useCallback((id: number) => {
    setCards(getCards(id));
  }, []);

  useEffect(() => {
    initFlashcardDb();
    if (!deckId) {
      setBanner({ message: 'Deck not found.', type: 'error' });
      router.back();
      return;
    }
    const d = getDeck(deckId);
    if (!d) {
      setBanner({ message: 'Deck not found.', type: 'error' });
      router.back();
      return;
    }
    setDeck(d);
    loadCards(deckId);
  }, [deckId, loadCards, router]);

  const addOne = () => {
    const f = front.trim();
    const b = back.trim();
    if (!f || !b) {
      setBanner({ message: 'Both front and back are required.', type: 'error' });
      return;
    }
    addCard(deckId, f, b, explanation.trim());
    setFront('');
    setBack('');
    setExplanation('');
    setRecent((prev) => prev + 1);
    loadCards(deckId);
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    backRef.current?.focus();
  };

  const onBulkChange = (text: string) => {
    setBulkText(text);
    setParsed(parseBulkInput(text));
  };

  const doBulkImport = () => {
    if (parsed.length === 0) {
      setBanner({ message: 'No valid cards found. Use "front | back" per line or JSON.', type: 'error' });
      return;
    }
    const count = addCardsBulk(deckId, parsed);
    setImportOpen(false);
    setBulkText('');
    setParsed([]);
    setRecent((prev) => prev + count);
    loadCards(deckId);
    setBanner({ message: `Imported ${count} cards.`, type: 'success' });
  };

  return (
    <KeyboardAvoidingView style={styles.keyboardWrap} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <View style={styles.root}>
    <LinearGradient colors={PURPLE_HEADER_GRADIENT} style={styles.headerBand}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.purpleDeep} translucent={false} />

      <FlashBanner
        visible={!!banner}
        message={banner?.message ?? ''}
        type={banner?.type ?? 'info'}
        onHide={() => setBanner(null)}
      />

      {/* HEADER */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>ADD CARD</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{deck?.name ?? 'Deck'}</Text>
        </View>
        <TouchableOpacity style={styles.headerBtn} onPress={() => setImportOpen(true)} activeOpacity={0.7}>
          <Ionicons name="pricetags-outline" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </LinearGradient>

    <LinearGradient colors={GRADIENT_COLORS} style={styles.gradient}>
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {recent > 0 && (
          <View style={styles.recentBanner}>
            <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
            <Text style={styles.recentBannerText}>
              {recent} {recent === 1 ? 'card' : 'cards'} added just now.
            </Text>
          </View>
        )}

        {/* SINGLE ENTRY */}
        <Text style={styles.sectionLabel}>ADD A CARD</Text>
        <View style={styles.entryCard}>
          <Text style={styles.inputLabel}>FRONT (QUESTION)</Text>
          <TextInput
            style={styles.input}
            value={front}
            onChangeText={setFront}
            placeholder="e.g. What is the capital of France?"
            placeholderTextColor={COLORS.textMuted}
            returnKeyType="next"
            onSubmitEditing={() => backRef.current?.focus()}
          />
          <Text style={styles.inputLabel}>BACK (ANSWER)</Text>
          <TextInput
            ref={backRef}
            style={styles.input}
            value={back}
            onChangeText={setBack}
            placeholder="e.g. Paris"
            placeholderTextColor={COLORS.textMuted}
            returnKeyType="done"
            onSubmitEditing={addOne}
          />
          <Text style={styles.inputLabel}>EXPLANATION (OPTIONAL)</Text>
          <TextInput
            style={[styles.input, styles.explanationInput]}
            value={explanation}
            onChangeText={setExplanation}
            placeholder="Why is this the answer?"
            placeholderTextColor={COLORS.textMuted}
            multiline
          />
          <TouchableOpacity style={styles.addBtn} onPress={addOne} activeOpacity={0.85}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.addBtnText}>Add card</Text>
          </TouchableOpacity>
        </View>

        {/* BULK IMPORT */}
        <Text style={styles.sectionLabel}>BULK IMPORT</Text>
        <TouchableOpacity style={styles.bulkBtn} onPress={() => setImportOpen(true)} activeOpacity={0.85}>
          <Ionicons name="pricetags-outline" size={18} color={COLORS.purpleLight} />
          <View style={styles.bulkInfo}>
            <Text style={styles.bulkTitle}>Paste a list of cards</Text>
            <Text style={styles.bulkSub}>One per line: front | back</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
        </TouchableOpacity>

        {/* CURRENT CARD COUNT */}
        <Text style={styles.sectionLabel}>IN THIS DECK</Text>
        <View style={styles.countCard}>
          <View style={styles.countIconWrap}>
            <Ionicons name="albums-outline" size={20} color={COLORS.purpleLight} />
          </View>
          <Text style={styles.countText}>
            {cards.length} {cards.length === 1 ? 'card' : 'cards'}
          </Text>
        </View>
      </ScrollView>
    </View>
    </LinearGradient>

    {/* BULK IMPORT MODAL */}
    <Modal visible={importOpen} transparent animationType="fade" onRequestClose={() => setImportOpen(false)}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, styles.bulkModalCard]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Bulk import</Text>
            <TouchableOpacity onPress={() => setImportOpen(false)} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
          <Text style={styles.inputLabel}>{'PASTE CARDS — "FRONT | BACK" PER LINE, OR JSON'}</Text>
          <TextInput
            style={[styles.input, styles.bulkInput]}
            value={bulkText}
            onChangeText={onBulkChange}
            placeholder={'Paris | Capital of France\nH2O | Chemical formula of water'}
            placeholderTextColor={COLORS.textMuted}
            multiline
            textAlignVertical="top"
          />
          <Text style={styles.bulkHint}>
            {parsed.length > 0
              ? `${parsed.length} valid ${parsed.length === 1 ? 'card' : 'cards'} ready to import.`
              : 'Separate each card with a new line; separate front and back with " | ".'}
          </Text>
          <TouchableOpacity
            style={[styles.modalImportBtn, parsed.length === 0 && styles.btnDisabled]}
            onPress={doBulkImport}
            disabled={parsed.length === 0}
            activeOpacity={0.85}
          >
            <Ionicons name="download-outline" size={16} color="#fff" />
            <Text style={styles.modalImportBtnText}>
              Import {parsed.length > 0 ? `${parsed.length} cards` : 'cards'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardWrap: { flex: 1 },
  root: { flex: 1 },
  headerBand: { overflow: 'hidden' },
  gradient: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
    paddingBottom: 26,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  headerTitleWrap: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  headerTitle: { color: '#fff', fontSize: 17, fontFamily: FONTS.extraBold },
  headerSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontFamily: FONTS.semiBold, marginTop: 2 },
  content: { paddingBottom: 60 },

  recentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(16,185,129,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.45)',
    borderRadius: 12,
    paddingVertical: 10,
    marginTop: 6,
    marginBottom: 14,
  },
  recentBannerText: { color: COLORS.success, fontSize: 13, fontFamily: FONTS.bold },

  sectionLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontFamily: FONTS.bold,
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 6,
  },

  entryCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 16,
    marginBottom: 24,
  },
  inputLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontFamily: FONTS.bold,
    letterSpacing: 1,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 9,
    color: COLORS.textPrimary,
    fontFamily: FONTS.medium,
  },
  explanationInput: { maxHeight: 120 },
  addBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.success,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 16,
  },
  addBtnText: { color: '#fff', fontSize: 15, fontFamily: FONTS.bold },

  bulkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 14,
    marginBottom: 24,
  },
  bulkInfo: { flex: 1 },
  bulkTitle: { color: COLORS.textPrimary, fontSize: 14, fontFamily: FONTS.bold, marginBottom: 2 },
  bulkSub: { color: COLORS.textMuted, fontSize: 12, fontFamily: FONTS.medium },

  countCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 14,
  },
  countIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(124,58,237,0.07)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  countText: { color: COLORS.textPrimary, fontSize: 15, fontFamily: FONTS.bold },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  bulkModalCard: { maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  modalTitle: { color: COLORS.textPrimary, fontSize: 18, fontFamily: FONTS.extraBold },
  bulkInput: { maxHeight: 220, minHeight: 120, paddingTop: 12 },
  bulkHint: { color: COLORS.textMuted, fontSize: 12, fontFamily: FONTS.medium, marginTop: 10 },
  modalImportBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.purpleVibrant,
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 16,
  },
  modalImportBtnText: { color: '#fff', fontSize: 14, fontFamily: FONTS.bold },
  btnDisabled: { opacity: 0.5 },
});