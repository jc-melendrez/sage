import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Animated,
  Platform,
  TextInput,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { COLORS, FONTS } from '@/constants/gameTheme';
import FlashBanner, { BannerType } from '@/components/FlashBanner';
import { Rating, RATINGS, CardState, intervalLabel, RATING_LABELS } from '@/services/srs';
import {
  Card,
  Deck,
  initFlashcardDb,
  getDeck,
  getDeckSummary,
  buildQueue,
  recordReview,
  revertReview,
  deleteReviewLog,
  deleteCard,
  getCard,
  updateCard,
  getCardState,
} from '@/services/flashcardService';

type Phase = 'setup' | 'study' | 'results';

interface UndoEntry {
  cardId: number;
  reviewId: number;
  rating: Rating;
  prevState: CardState;
  requeued: boolean;
}

const RATING_STYLE: Record<Rating, { bg: string; border: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  again: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.5)', color: '#F87171', icon: 'refresh' },
  hard: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.5)', color: '#FBBF24', icon: 'trending-down' },
  good: { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.5)', color: '#34D399', icon: 'checkmark' },
  easy: { bg: 'rgba(34,211,238,0.12)', border: 'rgba(34,211,238,0.5)', color: '#22D3EE', icon: 'trending-up' },
};

export default function StudyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ deckId: string }>();
  const deckId = Number(params.deckId);

  const [deck, setDeck] = useState<Deck | null>(null);
  const [phase, setPhase] = useState<Phase>('setup');
  const [cram, setCram] = useState(false);

  const [cards, setCards] = useState<Card[]>([]);
  const [pos, setPos] = useState(0);
  const [counts, setCounts] = useState<Record<Rating, number>>({ again: 0, hard: 0, good: 0, easy: 0 });
  const [history, setHistory] = useState<UndoEntry[]>([]);

  const [flipped, setFlipped] = useState(false);
  const flipAnim = useRef(new Animated.Value(0)).current;

  const [editOpen, setEditOpen] = useState(false);
  const [editFront, setEditFront] = useState('');
  const [editBack, setEditBack] = useState('');
  const [editExplanation, setEditExplanation] = useState('');

  const [banner, setBanner] = useState<{ message: string; type: BannerType } | null>(null);

  useEffect(() => {
    initFlashcardDb();
    const d = getDeck(deckId);
    if (d) {
      setDeck(d);
    } else {
      setBanner({ message: 'Deck not found.', type: 'error' });
      router.back();
    }
  }, [deckId]);

  const summary = useMemo(() => (deck ? getDeckSummary(deck.id) : null), [deck]);

  const startSession = () => {
    const entries = buildQueue(deckId, { cram });
    setCards(entries.map((e) => e.card));
    setPos(0);
    setCounts({ again: 0, hard: 0, good: 0, easy: 0 });
    setHistory([]);
    setFlipped(false);
    flipAnim.setValue(0);
    setPhase(entries.length > 0 ? 'study' : 'results');
  };

  const flipCard = () => {
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    Animated.timing(flipAnim, {
      toValue: flipped ? 0 : 1,
      duration: 350,
      useNativeDriver: true,
    }).start();
    setFlipped(!flipped);
  };

  const currentCard: Card | null = phase === 'study' ? cards[pos] ?? null : null;

  const handleRating = (rating: Rating) => {
    if (!currentCard || !flipped) return;
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const card = currentCard;
    const res = recordReview(card.id, deckId, rating);
    const requeued = rating === 'again';

    const updated = requeued ? [...cards, card] : cards;
    setCards(updated);
    setHistory((prev) => [
      ...prev,
      { cardId: card.id, reviewId: res.reviewId, rating, prevState: res.prevState, requeued },
    ]);
    setCounts((prev) => ({ ...prev, [rating]: prev[rating] + 1 }));

    const nextPos = pos + 1;
    if (nextPos >= updated.length) {
      setPhase('results');
    } else {
      setPos(nextPos);
    }
    setFlipped(false);
    flipAnim.setValue(0);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const entry = history[history.length - 1];
    setHistory((prev) => prev.slice(0, -1));
    setCounts((prev) => ({ ...prev, [entry.rating]: Math.max(0, prev[entry.rating] - 1) }));

    if (getCard(entry.cardId)) {
      revertReview(entry.cardId, entry.reviewId, entry.prevState);
    } else {
      deleteReviewLog(entry.reviewId);
    }

    if (entry.requeued) {
      setCards((prev) => prev.slice(0, -1));
    }
    setPos((prev) => Math.max(0, prev - 1));
    setFlipped(false);
    flipAnim.setValue(0);
  };

  const openEdit = () => {
    if (!currentCard) return;
    setEditFront(currentCard.front);
    setEditBack(currentCard.back);
    setEditExplanation(currentCard.explanation);
    setEditOpen(true);
  };

  const saveEdit = () => {
    if (!currentCard) return;
    if (!editFront.trim() || !editBack.trim()) {
      setBanner({ message: 'Front and back cannot be empty.', type: 'error' });
      return;
    }
    updateCard(currentCard.id, { front: editFront.trim(), back: editBack.trim(), explanation: editExplanation.trim() });
    setCards((prev) =>
      prev.map((c) => (c.id === currentCard.id ? { ...c, front: editFront.trim(), back: editBack.trim(), explanation: editExplanation.trim() } : c))
    );
    setEditOpen(false);
    setBanner({ message: 'Card updated.', type: 'success' });
  };

  const removeCard = () => {
    if (!currentCard) return;
    deleteCard(currentCard.id);
    setEditOpen(false);
    const remaining = cards.filter((c) => c.id !== currentCard.id);
    setCards(remaining);
    if (remaining.length === 0 || pos >= remaining.length) {
      setPhase('results');
      setPos(0);
    }
    setFlipped(false);
    flipAnim.setValue(0);
    setBanner({ message: 'Card deleted.', type: 'info' });
  };

  const frontRotate = flipAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const backRotate = flipAnim.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });

  const totalReviewed = Object.values(counts).reduce((a, b) => a + b, 0);
  const accuracy = totalReviewed > 0 ? Math.round(((counts.good + counts.easy) / totalReviewed) * 100) : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} translucent={false} />

      <FlashBanner
        visible={!!banner}
        message={banner?.message ?? ''}
        type={banner?.type ?? 'info'}
        onHide={() => setBanner(null)}
      />

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={COLORS.textSecondary} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>{deck?.name ?? 'Study'}</Text>
          <Text style={styles.headerSub}>
            {phase === 'study' ? `Card ${Math.min(pos + 1, cards.length)} of ${cards.length}` : phase === 'results' ? 'Session complete' : 'Ready to study'}
          </Text>
        </View>
        {phase === 'study' ? (
          <TouchableOpacity style={styles.headerBtn} onPress={openEdit} activeOpacity={0.7}>
            <Ionicons name="create-outline" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerBtnPlaceholder} />
        )}
      </View>

      {phase === 'setup' && deck ? (
        <View style={styles.setupWrap}>
          <View style={styles.deckBanner}>
            <View style={[styles.deckIconWrap, { backgroundColor: `${deck.color}22` }]}>
              <Ionicons name="library" size={30} color={deck.color} />
            </View>
            <Text style={styles.deckBannerTitle}>{deck.name}</Text>
            <Text style={styles.deckBannerSub}>{deck.subject || 'General'}</Text>
          </View>

          <View style={styles.setupStats}>
            <View style={styles.setupStat}>
              <Text style={[styles.setupStatValue, { color: COLORS.success }]}>{summary?.dueCount ?? 0}</Text>
              <Text style={styles.setupStatLabel}>DUE</Text>
            </View>
            <View style={styles.setupStat}>
              <Text style={[styles.setupStatValue, { color: COLORS.accentBright }]}>{summary?.newCount ?? 0}</Text>
              <Text style={styles.setupStatLabel}>NEW</Text>
            </View>
            <View style={styles.setupStat}>
              <Text style={[styles.setupStatValue, { color: COLORS.warning }]}>{summary?.learningCount ?? 0}</Text>
              <Text style={styles.setupStatLabel}>LEARNING</Text>
            </View>
            <View style={styles.setupStat}>
              <Text style={[styles.setupStatValue, { color: COLORS.success }]}>{summary?.matureCount ?? 0}</Text>
              <Text style={styles.setupStatLabel}>MATURE</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.cramToggle, cram && styles.cramToggleOn]}
            onPress={() => setCram((c) => !c)}
            activeOpacity={0.8}
          >
            <View style={styles.cramLeft}>
              <Ionicons name="flash" size={18} color={cram ? COLORS.warning : COLORS.textMuted} />
              <View>
                <Text style={[styles.cramTitle, cram && { color: COLORS.warning }]}>Cram mode</Text>
                <Text style={styles.cramSub}>Study every card, ignoring due dates</Text>
              </View>
            </View>
            <View style={[styles.toggleTrack, cram && styles.toggleTrackOn]}>
              <View style={[styles.toggleThumb, cram && styles.toggleThumbOn]} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.startBtn} onPress={startSession} activeOpacity={0.85}>
            <Ionicons name="play" size={18} color="#fff" />
            <Text style={styles.startBtnText}>Start session</Text>
          </TouchableOpacity>

          {(summary?.dueCount ?? 0) === 0 && (summary?.newCount ?? 0) === 0 && !cram && (
            <Text style={styles.nothingDueText}>
              Nothing due right now — turn on cram mode to review anyway.
            </Text>
          )}
        </View>
      ) : phase === 'study' && currentCard ? (
        <>
          {/* PROGRESS */}
          <View style={styles.progressRow}>
            <Text style={styles.progressText}>
              <Text style={styles.progressCurrent}>{pos + 1}</Text> / {cards.length}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${((pos + 1) / cards.length) * 100}%` }]} />
            </View>
            <Text style={styles.progressPct}>{Math.round(((pos + 1) / cards.length) * 100)}%</Text>
          </View>

          {/* FLIP CARD */}
          <View style={styles.cardStage}>
            <TouchableOpacity style={styles.flipCardTouch} onPress={flipCard} activeOpacity={1}>
              <Animated.View
                style={[styles.flashCard, styles.faceFront, { transform: [{ perspective: 1200 }, { rotateY: frontRotate }] }]}
              >
                <View style={styles.cardHighlight} />
                <View style={styles.qTab}>
                  <Text style={styles.qTabText}>QUESTION</Text>
                </View>
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.cardScrollContent}>
                  <Text style={styles.questionText}>{currentCard.front}</Text>
                </ScrollView>
                <Text style={styles.flipHint}>Tap to reveal answer</Text>
              </Animated.View>

              <Animated.View
                style={[styles.flashCard, styles.faceBack, { transform: [{ perspective: 1200 }, { rotateY: backRotate }] }]}
              >
                <View style={styles.cardHighlight} />
                <View style={[styles.qTab, styles.answerTab]}>
                  <Text style={styles.qTabText}>ANSWER</Text>
                </View>
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.cardScrollContent}>
                  <Text style={styles.answerText}>{currentCard.back}</Text>
                  {currentCard.explanation ? (
                    <View style={styles.explanationBox}>
                      <Text style={styles.explanationLabel}>WHY</Text>
                      <Text style={styles.explanationText}>{currentCard.explanation}</Text>
                    </View>
                  ) : null}
                </ScrollView>
              </Animated.View>
            </TouchableOpacity>
          </View>

          {/* UNDO + RATINGS */}
          <View style={[styles.bottomWrap, { paddingBottom: insets.bottom + 14 }]}>
            {history.length > 0 && (
              <TouchableOpacity style={styles.undoBtn} onPress={handleUndo} activeOpacity={0.8}>
                <Ionicons name="arrow-undo" size={15} color={COLORS.textMuted} />
                <Text style={styles.undoText}>Undo last rating</Text>
              </TouchableOpacity>
            )}
            <View style={styles.ratingRow}>
              {RATINGS.map((rating) => {
                const style = RATING_STYLE[rating];
                const state = currentCard ? getCardState(currentCard.id) : undefined;
                return (
                  <TouchableOpacity
                    key={rating}
                    style={[styles.ratingBtn, { backgroundColor: style.bg, borderColor: style.border }]}
                    disabled={!flipped}
                    onPress={() => handleRating(rating)}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.ratingIconWrap, { backgroundColor: `${style.color}22` }]}>
                      <Ionicons name={style.icon} size={15} color={style.color} />
                    </View>
                    <Text style={[styles.ratingLabel, { color: style.color }]}>{RATING_LABELS[rating]}</Text>
                    {flipped && state && (
                      <Text style={styles.ratingInterval}>{intervalLabel(state, rating)}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </>
      ) : phase === 'results' ? (
        <ScrollView style={styles.resultsScroll} contentContainerStyle={styles.resultsContent}>
          <View style={styles.resultsHeader}>
            <View style={styles.resultsIconWrap}>
              <Ionicons name="trophy" size={44} color={COLORS.warning} />
            </View>
            <Text style={styles.resultsTitle}>Session complete!</Text>
            <Text style={styles.resultsSub}>
              You reviewed {totalReviewed} {totalReviewed === 1 ? 'card' : 'cards'}.
            </Text>
          </View>

          <View style={styles.statsRow}>
            {RATINGS.map((rating) => (
              <View key={rating} style={styles.statCard}>
                <Text style={[styles.statValue, { color: RATING_STYLE[rating].color }]}>{counts[rating]}</Text>
                <Text style={styles.statLabel}>{RATING_LABELS[rating].toUpperCase()}</Text>
              </View>
            ))}
          </View>

          <View style={styles.accuracyCard}>
            <Text style={styles.accuracyValue}>{accuracy}%</Text>
            <Text style={styles.accuracyLabel}>ACCURACY (GOOD + EASY)</Text>
          </View>

          {counts.again > 0 && (
            <View style={styles.againNote}>
              <Ionicons name="refresh" size={16} color={COLORS.warning} />
              <Text style={styles.againNoteText}>
                {counts.again} {counts.again === 1 ? 'card' : 'cards'} need another look.
              </Text>
            </View>
          )}

          <View style={[styles.resultsActions, { paddingBottom: insets.bottom + 16 }]}>
            {counts.again > 0 && (
              <TouchableOpacity style={[styles.actionBtn, styles.reviewAgainBtn]} onPress={startSession} activeOpacity={0.8}>
                <Ionicons name="refresh" size={18} color={COLORS.warning} />
                <Text style={[styles.actionBtnText, { color: COLORS.warning }]}>Review again</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.actionBtn, styles.doneBtn]} onPress={() => router.back()} activeOpacity={0.8}>
              <Ionicons name="checkmark" size={18} color="#fff" />
              <Text style={styles.actionBtnTextWhite}>Done</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : null}

      {/* EDIT MODAL */}
      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit card</Text>
              <TouchableOpacity onPress={() => setEditOpen(false)} activeOpacity={0.7}>
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
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.deleteBtn]} onPress={removeCard} activeOpacity={0.8}>
                <Ionicons name="trash" size={16} color={COLORS.danger} />
                <Text style={[styles.modalBtnText, { color: COLORS.danger }]}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.saveBtn]} onPress={saveEdit} activeOpacity={0.8}>
                <Text style={styles.modalBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(127,119,221,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(127,119,221,0.25)',
  },
  headerBtnPlaceholder: { width: 40 },
  headerTitleWrap: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  headerTitle: { color: COLORS.textPrimary, fontSize: 17, fontFamily: FONTS.extraBold },
  headerSub: { color: COLORS.textMuted, fontSize: 12, fontFamily: FONTS.semiBold, marginTop: 2 },

  // Setup
  setupWrap: { flex: 1, justifyContent: 'center', paddingBottom: 40 },
  deckBanner: { alignItems: 'center', marginBottom: 24 },
  deckIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  deckBannerTitle: { color: COLORS.textPrimary, fontSize: 22, fontFamily: FONTS.black, textAlign: 'center' },
  deckBannerSub: { color: COLORS.textMuted, fontSize: 13, fontFamily: FONTS.medium, marginTop: 4 },
  setupStats: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  setupStat: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    paddingVertical: 14,
    alignItems: 'center',
  },
  setupStatValue: { fontSize: 22, fontFamily: FONTS.black },
  setupStatLabel: { color: COLORS.textMuted, fontSize: 9, fontFamily: FONTS.bold, letterSpacing: 1, marginTop: 4 },
  cramToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 20,
  },
  cramToggleOn: { borderColor: 'rgba(245,158,11,0.5)', backgroundColor: 'rgba(245,158,11,0.06)' },
  cramLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  cramTitle: { color: COLORS.textPrimary, fontSize: 14, fontFamily: FONTS.bold },
  cramSub: { color: COLORS.textMuted, fontSize: 11, fontFamily: FONTS.medium, marginTop: 2 },
  toggleTrack: {
    width: 46,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  toggleTrackOn: { backgroundColor: COLORS.warning },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  toggleThumbOn: { alignSelf: 'flex-end' },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.purpleVibrant,
    borderRadius: 14,
    paddingVertical: 16,
  },
  startBtnText: { color: '#fff', fontSize: 16, fontFamily: FONTS.bold },
  nothingDueText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontFamily: FONTS.medium,
    textAlign: 'center',
    marginTop: 16,
  },

  // Study
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  progressText: { color: COLORS.textSecondary, fontSize: 13, fontFamily: FONTS.bold },
  progressCurrent: { color: COLORS.accentBright },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: COLORS.purpleVibrant },
  progressPct: { color: COLORS.textMuted, fontSize: 12, fontFamily: FONTS.bold },
  cardStage: { flex: 1, justifyContent: 'center', paddingBottom: 10 },
  flipCardTouch: { flex: 1, minHeight: 320 },
  flashCard: {
    flex: 1,
    backgroundColor: COLORS.cardBg,
    borderRadius: 24,
    padding: 24,
    paddingTop: 28,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 32,
    elevation: 16,
  },
  faceFront: { backfaceVisibility: 'hidden' },
  faceBack: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  cardHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  qTab: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.purplePrimary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 16,
  },
  answerTab: { backgroundColor: COLORS.success },
  qTabText: {
    color: COLORS.accentBright,
    fontSize: 11,
    fontFamily: FONTS.extraBold,
    letterSpacing: 1,
  },
  cardScrollContent: { flexGrow: 1, justifyContent: 'center' },
  questionText: { color: '#fff', fontSize: 21, fontFamily: FONTS.bold, lineHeight: 30 },
  answerText: { color: COLORS.accentBright, fontSize: 24, fontFamily: FONTS.extraBold, lineHeight: 33 },
  explanationBox: {
    marginTop: 20,
    backgroundColor: 'rgba(127,119,221,0.12)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  explanationLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontFamily: FONTS.bold,
    letterSpacing: 1,
    marginBottom: 6,
  },
  explanationText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontFamily: FONTS.medium,
    lineHeight: 19,
  },
  flipHint: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontFamily: FONTS.semiBold,
    textAlign: 'center',
    marginTop: 14,
    opacity: 0.7,
  },
  bottomWrap: { paddingTop: 8 },
  undoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  undoText: { color: COLORS.textMuted, fontSize: 12, fontFamily: FONTS.semiBold },
  ratingRow: { flexDirection: 'row', gap: 8 },
  ratingBtn: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 5,
  },
  ratingIconWrap: { width: 26, height: 26, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },
  ratingLabel: { fontSize: 12, fontFamily: FONTS.bold },
  ratingInterval: { color: COLORS.textMuted, fontSize: 10, fontFamily: FONTS.semiBold },

  // Results
  resultsScroll: { flex: 1 },
  resultsContent: { paddingBottom: 20 },
  resultsHeader: { alignItems: 'center', marginTop: 24, marginBottom: 24 },
  resultsIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  resultsTitle: { color: COLORS.textPrimary, fontSize: 22, fontFamily: FONTS.black, marginBottom: 6 },
  resultsSub: { color: COLORS.textMuted, fontSize: 14, fontFamily: FONTS.medium },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  statValue: { fontSize: 22, fontFamily: FONTS.black, marginBottom: 4 },
  statLabel: { color: COLORS.textMuted, fontSize: 9, fontFamily: FONTS.bold, letterSpacing: 1 },
  accuracyCard: {
    backgroundColor: 'rgba(16,185,129,0.1)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.4)',
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  accuracyValue: { color: COLORS.success, fontSize: 30, fontFamily: FONTS.black },
  accuracyLabel: { color: COLORS.textMuted, fontSize: 10, fontFamily: FONTS.bold, letterSpacing: 1, marginTop: 4 },
  againNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  againNoteText: { color: COLORS.warning, fontSize: 13, fontFamily: FONTS.semiBold },
  resultsActions: { flexDirection: 'row', gap: 12, paddingTop: 6 },
  actionBtn: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
  },
  reviewAgainBtn: {
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderColor: 'rgba(245,158,11,0.4)',
  },
  doneBtn: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  actionBtnText: { fontSize: 15, fontFamily: FONTS.bold },
  actionBtnTextWhite: { color: '#fff', fontSize: 15, fontFamily: FONTS.bold },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  modalTitle: { color: COLORS.textPrimary, fontSize: 18, fontFamily: FONTS.extraBold },
  inputLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontFamily: FONTS.bold,
    letterSpacing: 1,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: COLORS.textPrimary,
    fontFamily: FONTS.medium,
    maxHeight: 160,
  },
  explanationInput: { maxHeight: 120 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
  },
  deleteBtn: { backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.4)' },
  saveBtn: { backgroundColor: COLORS.purpleVibrant, borderColor: COLORS.purpleVibrant },
  modalBtnText: { color: '#fff', fontSize: 14, fontFamily: FONTS.bold },
});
