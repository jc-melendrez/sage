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
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, DECK_COLORS, GRADIENT_COLORS, PURPLE_HEADER_GRADIENT } from '@/constants/gameTheme';
import FlashBanner, { BannerType } from '@/components/FlashBanner';
import {
  Card,
  initFlashcardDb,
  getDeck,
  getCards,
  createDeck,
  updateDeck,
  deleteDeck,
  updateCard,
  deleteCard,
} from '@/services/flashcardService';

export default function EditDeckScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ deckId?: string }>();
  const deckId = params.deckId ? Number(params.deckId) : null;

  const [deckCreated, setDeckCreated] = useState(false);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [color, setColor] = useState(DECK_COLORS[0]);
  const [cards, setCards] = useState<Card[]>([]);

  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editFront, setEditFront] = useState('');
  const [editBack, setEditBack] = useState('');
  const [editExplanation, setEditExplanation] = useState('');

  const [banner, setBanner] = useState<{ message: string; type: BannerType } | null>(null);

  const loadCards = useCallback((deckIdNum: number) => {
    setCards(getCards(deckIdNum));
  }, []);

  useEffect(() => {
    initFlashcardDb();
    if (deckId) {
      const deck = getDeck(deckId);
      if (deck) {
        setName(deck.name);
        setSubject(deck.subject);
        setColor(deck.color);
        setDeckCreated(true);
        loadCards(deck.id);
      } else {
        setBanner({ message: 'Deck not found.', type: 'error' });
        router.back();
      }
    }
  }, [deckId, loadCards]);

  const ensureDeck = (): number | null => {
    if (deckCreated && deckId) return deckId;
    const trimmed = name.trim();
    if (!trimmed) {
      setBanner({ message: 'Give your deck a name first.', type: 'error' });
      return null;
    }
    const deck = createDeck(trimmed, { subject: subject.trim(), color });
    setDeckCreated(true);
    loadCards(deck.id);
    router.setParams({ deckId: String(deck.id) });
    return deck.id;
  };

  const saveSettings = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setBanner({ message: 'Deck name cannot be empty.', type: 'error' });
      return;
    }
    const id = ensureDeck();
    if (!id) return;
    updateDeck(id, { name: trimmed, subject: subject.trim(), color });
    setBanner({ message: 'Deck saved.', type: 'success' });
  };

  const openCardEdit = (index: number) => {
    const card = cards[index];
    setEditIndex(index);
    setEditFront(card.front);
    setEditBack(card.back);
    setEditExplanation(card.explanation);
  };

  const saveCardEdit = () => {
    if (editIndex === null) return;
    const card = cards[editIndex];
    if (!editFront.trim() || !editBack.trim()) {
      setBanner({ message: 'Front and back cannot be empty.', type: 'error' });
      return;
    }
    updateCard(card.id, { front: editFront.trim(), back: editBack.trim(), explanation: editExplanation.trim() });
    setCards((prev) =>
      prev.map((c) => (c.id === card.id ? { ...c, front: editFront.trim(), back: editBack.trim(), explanation: editExplanation.trim() } : c))
    );
    setEditIndex(null);
    setBanner({ message: 'Card updated.', type: 'success' });
  };

  const removeCardAt = (index: number) => {
    const card = cards[index];
    deleteCard(card.id);
    setCards((prev) => prev.filter((c) => c.id !== card.id));
    setBanner({ message: 'Card deleted.', type: 'info' });
  };

  const confirmRemoveDeck = () => {
    if (!deckId) return;
    Alert.alert('Delete deck?', `"${name}" and all its cards will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteDeck(deckId);
          router.back();
        },
      },
    ]);
  };

  const goAddCard = () => {
    if (!deckId) {
      setBanner({ message: 'Save your deck first, then add cards.', type: 'error' });
      return;
    }
    router.push({ pathname: '/flashcards/add', params: { deckId: String(deckId) } });
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
          <Text style={styles.headerTitle}>{deckId ? 'EDIT DECK' : 'NEW DECK'}</Text>
          <Text style={styles.headerSub}>{cards.length} {cards.length === 1 ? 'card' : 'cards'}</Text>
        </View>
        {deckId ? (
          <TouchableOpacity style={styles.headerBtn} onPress={confirmRemoveDeck} activeOpacity={0.7}>
            <Ionicons name="trash-outline" size={18} color="#fff" />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerBtnPlaceholder} />
        )}
      </View>
    </LinearGradient>

    <LinearGradient colors={GRADIENT_COLORS} style={styles.gradient}>
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* SETTINGS */}
        <Text style={styles.sectionLabel}>DECK SETTINGS</Text>
        <View style={styles.settingsCard}>
          <Text style={styles.inputLabel}>NAME</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Spanish Vocabulary"
            placeholderTextColor={COLORS.textMuted}
          />
          <Text style={styles.inputLabel}>SUBJECT</Text>
          <TextInput
            style={styles.input}
            value={subject}
            onChangeText={setSubject}
            placeholder="e.g. Languages"
            placeholderTextColor={COLORS.textMuted}
          />
          <Text style={styles.inputLabel}>COLOR</Text>
          <View style={styles.colorRow}>
            {DECK_COLORS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.colorSwatch, { backgroundColor: c }, color === c && styles.colorSwatchActive]}
                onPress={() => setColor(c)}
                activeOpacity={0.7}
              />
            ))}
          </View>
          <TouchableOpacity style={styles.saveBtn} onPress={saveSettings} activeOpacity={0.85}>
            <Ionicons name="checkmark" size={16} color="#fff" />
            <Text style={styles.saveBtnText}>Save deck settings</Text>
          </TouchableOpacity>
        </View>

        {/* ADD A CARD */}
        <Text style={styles.sectionLabel}>ADD A CARD</Text>
        <View style={styles.addCardWrap}>
          <TouchableOpacity style={styles.addCardNavBtn} onPress={goAddCard} activeOpacity={0.85}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.addCardNavText}>Add card</Text>
          </TouchableOpacity>
          <Text style={styles.addCardHint}>Add cards one at a time or bulk import from the Add Card screen.</Text>
        </View>

        {/* CARDS */}
        <View style={styles.cardsHeader}>
          <Text style={styles.sectionLabel}>CARDS</Text>
        </View>
        {cards.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="layers-outline" size={34} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>No cards yet — tap &ldquo;Add card&rdquo; above.</Text>
          </View>
        ) : (
          cards.map((card, index) => (
            <View key={card.id} style={styles.cardRow}>
              <View style={styles.cardRowIndex}>
                <Text style={styles.cardRowIndexText}>{index + 1}</Text>
              </View>
              <View style={styles.cardRowInfo}>
                <Text style={styles.cardRowFront} numberOfLines={1}>{card.front}</Text>
                <Text style={styles.cardRowBack} numberOfLines={1}>{card.back}</Text>
              </View>
              <TouchableOpacity onPress={() => openCardEdit(index)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="create-outline" size={19} color={COLORS.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => removeCardAt(index)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>

      {/* CARD EDIT MODAL */}
      <Modal visible={editIndex !== null} transparent animationType="fade" onRequestClose={() => setEditIndex(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit card</Text>
              <TouchableOpacity onPress={() => setEditIndex(null)} activeOpacity={0.7}>
                <Ionicons name="close" size={22} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.inputLabel}>FRONT</Text>
            <TextInput
              style={styles.input}
              value={editFront}
              onChangeText={setEditFront}
              placeholder="Question"
              placeholderTextColor={COLORS.textMuted}
              multiline
            />
            <Text style={styles.inputLabel}>BACK</Text>
            <TextInput
              style={styles.input}
              value={editBack}
              onChangeText={setEditBack}
              placeholder="Answer"
              placeholderTextColor={COLORS.textMuted}
              multiline
            />
            <Text style={styles.inputLabel}>EXPLANATION (OPTIONAL)</Text>
            <TextInput
              style={[styles.input, styles.explanationInput]}
              value={editExplanation}
              onChangeText={setEditExplanation}
              placeholder="Why is this the answer?"
              placeholderTextColor={COLORS.textMuted}
              multiline
            />
            <TouchableOpacity style={styles.saveBtn} onPress={saveCardEdit} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>Save card</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      </View>
      </LinearGradient>
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
  headerBtnPlaceholder: { width: 40 },
  headerTitleWrap: { alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 17, fontFamily: FONTS.extraBold },
  headerSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontFamily: FONTS.semiBold, marginTop: 2 },
  content: { paddingBottom: 60 },

  sectionLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontFamily: FONTS.bold,
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 6,
  },
  settingsCard: {
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
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  colorSwatch: { width: 32, height: 32, borderRadius: 16 },
  colorSwatchActive: { borderWidth: 3, borderColor: COLORS.purpleDark },
  saveBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.purpleVibrant,
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 16,
  },
  saveBtnText: { color: '#fff', fontSize: 14, fontFamily: FONTS.bold },

  addCardWrap: { marginBottom: 24 },
  addCardNavBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.success,
    borderRadius: 12,
    paddingVertical: 14,
  },
  addCardNavText: { color: '#fff', fontSize: 15, fontFamily: FONTS.bold },
  addCardHint: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontFamily: FONTS.medium,
    textAlign: 'center',
    marginTop: 8,
  },

  cardsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  emptyWrap: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 30,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyText: { color: COLORS.textMuted, fontSize: 13, fontFamily: FONTS.medium },

  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 8,
  },
  cardRowIndex: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(139,92,246,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardRowIndexText: { color: COLORS.purpleLight, fontSize: 12, fontFamily: FONTS.bold },
  cardRowInfo: { flex: 1 },
  cardRowFront: { color: COLORS.textPrimary, fontSize: 13, fontFamily: FONTS.bold, marginBottom: 2 },
  cardRowBack: { color: COLORS.textMuted, fontSize: 12, fontFamily: FONTS.medium },

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
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  modalTitle: { color: COLORS.textPrimary, fontSize: 18, fontFamily: FONTS.extraBold },
  explanationInput: { maxHeight: 120 },
});