import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  TextInput,
  Modal,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { COLORS, FONTS, DECK_COLORS } from '@/constants/gameTheme';
import FlashBanner, { BannerType } from '@/components/FlashBanner';
import { API_BASE_URL } from '@/config/api';
import { getToken } from '@/services/authService';
import {
  Deck,
  initFlashcardDb,
  getDecks,
  getDeckSummary,
  getStreak,
  getReviewCountOn,
  getTotalReviews,
  getRatingTotals,
  createDeck,
  searchCards,
  CardSearchMatch,
  importDeckFromQuiz,
  QuizPayload,
} from '@/services/flashcardService';
import { maturityOf } from '@/services/srs';

export default function FlashcardsHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [decks, setDecks] = useState<Deck[]>([]);
  const [summaries, setSummaries] = useState<Record<number, ReturnType<typeof getDeckSummary>>>({});
  const [loaded, setLoaded] = useState(false);

  const [streak, setStreak] = useState(0);
  const [reviewsToday, setReviewsToday] = useState(0);
  const [totalReviews, setTotalReviews] = useState(0);
  const [totals, setTotals] = useState<Record<string, number>>({});

  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<CardSearchMatch[]>([]);

  const [newDeckOpen, setNewDeckOpen] = useState(false);
  const [deckName, setDeckName] = useState('');
  const [deckSubject, setDeckSubject] = useState('');
  const [deckColor, setDeckColor] = useState(DECK_COLORS[0]);

  const [importOpen, setImportOpen] = useState(false);
  const [quizzes, setQuizzes] = useState<QuizPayload[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const [banner, setBanner] = useState<{ message: string; type: BannerType } | null>(null);

  const refresh = useCallback(() => {
    const all = getDecks();
    setDecks(all);
    const map: Record<number, ReturnType<typeof getDeckSummary>> = {};
    for (const d of all) map[d.id] = getDeckSummary(d.id);
    setSummaries(map);
    setStreak(getStreak());
    setReviewsToday(getReviewCountOn(new Date()));
    setTotalReviews(getTotalReviews());
    setTotals(getRatingTotals());
    setLoaded(true);
  }, []);

  useEffect(() => {
    initFlashcardDb();
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (query.trim()) setMatches(searchCards(query));
    else setMatches([]);
  }, [query, decks, summaries]);

  const accuracy = useMemo(() => {
    const total = Object.values(totals).reduce((a, b) => a + b, 0);
    if (total === 0) return 0;
    return Math.round(((totals.good + totals.easy) / total) * 100);
  }, [totals]);

  const openStudy = (deckId: number) => router.push({ pathname: '/game/flashcards/study', params: { deckId } });
  const openEdit = (deckId: number) => router.push({ pathname: '/game/flashcards/edit', params: { deckId } });

  const createNewDeck = () => {
    const name = deckName.trim();
    if (!name) return;
    const deck = createDeck(name, { subject: deckSubject.trim(), color: deckColor });
    setNewDeckOpen(false);
    setDeckName('');
    setDeckSubject('');
    refresh();
    openEdit(deck.id);
  };

  const fetchQuizzes = async () => {
    setImportLoading(true);
    setImportError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/ai/quizzes/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load quizzes');
      const data = await res.json();
      setQuizzes(Array.isArray(data) ? data : []);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setImportLoading(false);
    }
  };

  const pickQuiz = (quiz: QuizPayload) => {
    const deck = importDeckFromQuiz(quiz, DECK_COLORS[decks.length % DECK_COLORS.length]);
    if (!deck) {
      setBanner({ message: 'This quiz has no questions to import.', type: 'error' });
      return;
    }
    setImportOpen(false);
    refresh();
    setBanner({ message: `Imported "${deck.name}" with ${deck ? getDeckSummary(deck.id).total : 0} cards.`, type: 'success' });
  };

  const filteredDecks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return decks;
    return decks.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.subject.toLowerCase().includes(q) ||
        (matches.some((m) => m.deckId === d.id))
    );
  }, [decks, query, matches]);

  const totalCards = decks.reduce((sum, d) => sum + (summaries[d.id]?.total ?? 0), 0);
  const totalDue = decks.reduce((sum, d) => sum + (summaries[d.id]?.dueCount ?? 0), 0);

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
          <Text style={styles.headerTitle}>SOLO MODE</Text>
          <Text style={styles.headerSub}>Flashcard studio</Text>
        </View>
        <TouchableOpacity style={styles.headerBtn} onPress={() => setImportOpen(true)} activeOpacity={0.7}>
          <Ionicons name="cloud-download-outline" size={20} color={COLORS.accentBright} />
        </TouchableOpacity>
      </View>

      {!loaded ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
        </View>
      ) : (
        <>
          {/* STAT STRIP */}
          <View style={styles.statStrip}>
            <View style={styles.statCell}>
              <Text style={styles.statValue}>{streak}</Text>
              <Text style={styles.statLabel}>DAY STREAK</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statValue}>{reviewsToday}</Text>
              <Text style={styles.statLabel}>TODAY</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statValue}>{accuracy}%</Text>
              <Text style={styles.statLabel}>ACCURACY</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statValue}>{totalCards}</Text>
              <Text style={styles.statLabel}>CARDS</Text>
            </View>
          </View>

          {/* SEARCH */}
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={18} color={COLORS.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search decks or cards..."
              placeholderTextColor={COLORS.textMuted}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} activeOpacity={0.7}>
                <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {totalDue > 0 && (
            <TouchableOpacity
              style={styles.reviewNowBtn}
              activeOpacity={0.85}
              onPress={() => openStudy(decks.find((d) => (summaries[d.id]?.dueCount ?? 0) > 0)!.id)}
            >
              <View>
                <Text style={styles.reviewNowTitle}>{totalDue} cards due for review</Text>
                <Text style={styles.reviewNowSub}>Tap to start your session</Text>
              </View>
              <View style={styles.reviewNowCta}>
                <Ionicons name="play" size={16} color="#fff" />
                <Text style={styles.reviewNowCtaText}>Study</Text>
              </View>
            </TouchableOpacity>
          )}

          {matches.length > 0 && (
            <View style={styles.searchResults}>
              <Text style={styles.sectionLabel}>CARD RESULTS ({matches.reduce((s, m) => s + m.cards.length, 0)})</Text>
              {matches.map((m) => (
                <TouchableOpacity
                  key={m.deckId}
                  style={styles.resultCard}
                  onPress={() => openEdit(m.deckId)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.resultDot, { backgroundColor: m.deckColor }]} />
                  <View style={styles.resultInfo}>
                    <Text style={styles.resultDeck} numberOfLines={1}>{m.deckName}</Text>
                    {m.cards.slice(0, 2).map((c) => (
                      <Text key={c.id} style={styles.resultCardText} numberOfLines={1}>
                        {c.front}
                      </Text>
                    ))}
                    {m.cards.length > 2 && (
                      <Text style={styles.resultMore}>+{m.cards.length - 2} more</Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
            {filteredDecks.length === 0 ? (
              <View style={styles.emptyWrap}>
                <View style={styles.emptyIconWrap}>
                  <Ionicons name="albums-outline" size={52} color={COLORS.purpleLight} />
                </View>
                <Text style={styles.emptyTitle}>No decks yet</Text>
                <Text style={styles.emptyDesc}>
                  Create a deck from scratch, or import one of your AI quizzes to start studying.
                </Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => setNewDeckOpen(true)} activeOpacity={0.85}>
                  <Ionicons name="add" size={18} color="#fff" />
                  <Text style={styles.primaryBtnText}>New deck</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.sectionLabel}>YOUR DECKS</Text>
                {filteredDecks.map((deck) => {
                  const s = summaries[deck.id] ?? { total: 0, newCount: 0, learningCount: 0, matureCount: 0, dueCount: 0 };
                  const statusColors = {
                    new: COLORS.accentBright,
                    learning: COLORS.warning,
                    mature: COLORS.success,
                  };
                  return (
                    <TouchableOpacity
                      key={deck.id}
                      style={styles.deckCard}
                      activeOpacity={0.8}
                      onPress={() => openStudy(deck.id)}
                    >
                      <View style={[styles.deckAccent, { backgroundColor: deck.color }]} />
                      <View style={styles.deckIconWrap}>
                        <Ionicons name="library" size={22} color={deck.color} />
                      </View>
                      <View style={styles.deckInfo}>
                        <Text style={styles.deckName} numberOfLines={1}>{deck.name}</Text>
                        <Text style={styles.deckMeta} numberOfLines={1}>
                          {deck.subject || 'General'} · {s.total} {s.total === 1 ? 'card' : 'cards'}
                        </Text>
                        <View style={styles.deckMaturityRow}>
                          {s.newCount > 0 && (
                            <View style={styles.maturityChip}>
                              <View style={[styles.maturityDot, { backgroundColor: statusColors.new }]} />
                              <Text style={styles.maturityText}>{s.newCount} new</Text>
                            </View>
                          )}
                          {s.learningCount > 0 && (
                            <View style={styles.maturityChip}>
                              <View style={[styles.maturityDot, { backgroundColor: statusColors.learning }]} />
                              <Text style={styles.maturityText}>{s.learningCount} learning</Text>
                            </View>
                          )}
                          {s.matureCount > 0 && (
                            <View style={styles.maturityChip}>
                              <View style={[styles.maturityDot, { backgroundColor: statusColors.mature }]} />
                              <Text style={styles.maturityText}>{s.matureCount} mature</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      <View style={styles.deckActions}>
                        {s.dueCount > 0 && (
                          <View style={styles.dueBadge}>
                            <Text style={styles.dueBadgeText}>{s.dueCount}</Text>
                          </View>
                        )}
                        <TouchableOpacity onPress={() => openEdit(deck.id)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons name="create-outline" size={20} color={COLORS.textMuted} />
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </ScrollView>

          {/* FLOATING ADD */}
          {filteredDecks.length > 0 && (
            <TouchableOpacity
              style={[styles.fab, { bottom: insets.bottom + 20 }]}
              onPress={() => setNewDeckOpen(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="add" size={26} color="#fff" />
            </TouchableOpacity>
          )}
        </>
      )}

      {/* NEW DECK MODAL */}
      <Modal visible={newDeckOpen} transparent animationType="fade" onRequestClose={() => setNewDeckOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New deck</Text>
              <TouchableOpacity onPress={() => setNewDeckOpen(false)} activeOpacity={0.7}>
                <Ionicons name="close" size={22} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.inputLabel}>NAME</Text>
            <TextInput
              style={styles.input}
              value={deckName}
              onChangeText={setDeckName}
              placeholder="e.g. Spanish Vocabulary"
              placeholderTextColor={COLORS.textMuted}
              autoFocus
              returnKeyType="next"
            />
            <Text style={styles.inputLabel}>SUBJECT (OPTIONAL)</Text>
            <TextInput
              style={styles.input}
              value={deckSubject}
              onChangeText={setDeckSubject}
              placeholder="e.g. Languages"
              placeholderTextColor={COLORS.textMuted}
              returnKeyType="done"
              onSubmitEditing={createNewDeck}
            />
            <Text style={styles.inputLabel}>COLOR</Text>
            <View style={styles.colorRow}>
              {DECK_COLORS.map((color) => (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: color },
                    deckColor === color && styles.colorSwatchActive,
                  ]}
                  onPress={() => setDeckColor(color)}
                  activeOpacity={0.7}
                />
              ))}
            </View>
            <TouchableOpacity
              style={[styles.primaryBtn, styles.modalSubmit, !deckName.trim() && styles.btnDisabled]}
              onPress={createNewDeck}
              disabled={!deckName.trim()}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Create deck</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* IMPORT MODAL */}
      <Modal visible={importOpen} transparent animationType="fade" onRequestClose={() => setImportOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, styles.importCard]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Import from quiz</Text>
              <TouchableOpacity onPress={() => setImportOpen(false)} activeOpacity={0.7}>
                <Ionicons name="close" size={22} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.inputLabel}>PICK A QUIZ — IT BECOMES A DECK</Text>
            {importError && <Text style={styles.errorText}>{importError}</Text>}
            {quizzes.length === 0 ? (
              <View style={styles.importEmpty}>
                {importLoading ? (
                  <ActivityIndicator color={COLORS.purpleVibrant} />
                ) : (
                  <Text style={styles.emptyDesc}>
                    Load quizzes from the Activities tab to convert them into flashcard decks.
                  </Text>
                )}
                <TouchableOpacity style={styles.secondaryBtn} onPress={fetchQuizzes} activeOpacity={0.85} disabled={importLoading}>
                  <Ionicons name="refresh" size={16} color={COLORS.purpleLight} />
                  <Text style={styles.secondaryBtnText}>Load quizzes</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView style={styles.quizList} showsVerticalScrollIndicator={false}>
                {quizzes.map((quiz) => (
                  <TouchableOpacity
                    key={quiz.id}
                    style={styles.quizRow}
                    onPress={() => pickQuiz(quiz)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.quizIconWrap}>
                      <Ionicons name="document-text" size={20} color={COLORS.accentBright} />
                    </View>
                    <View style={styles.quizInfo}>
                      <Text style={styles.quizTitle} numberOfLines={1}>{quiz.title}</Text>
                      <Text style={styles.quizMeta}>
                        {(quiz.questions ?? []).length} questions · {quiz.quiz_type || 'Quiz'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
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
  headerTitleWrap: { alignItems: 'center' },
  headerTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontFamily: FONTS.extraBold,
    letterSpacing: 1,
  },
  headerSub: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontFamily: FONTS.semiBold,
    marginTop: 2,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 80 },

  statStrip: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    paddingVertical: 14,
    marginBottom: 14,
  },
  statCell: { flex: 1, alignItems: 'center' },
  statValue: { color: COLORS.textPrimary, fontSize: 18, fontFamily: FONTS.black },
  statLabel: { color: COLORS.textMuted, fontSize: 9, fontFamily: FONTS.bold, letterSpacing: 0.8, marginTop: 4 },
  statDivider: { width: 1, backgroundColor: 'rgba(127,119,221,0.2)' },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  searchInput: { flex: 1, color: COLORS.textPrimary, fontFamily: FONTS.medium, paddingVertical: Platform.OS === 'ios' ? 12 : 8 },

  reviewNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(16,185,129,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.4)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  reviewNowTitle: { color: COLORS.success, fontSize: 15, fontFamily: FONTS.bold },
  reviewNowSub: { color: COLORS.textMuted, fontSize: 12, fontFamily: FONTS.medium, marginTop: 2 },
  reviewNowCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.success,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  reviewNowCtaText: { color: '#fff', fontSize: 13, fontFamily: FONTS.bold },

  sectionLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontFamily: FONTS.bold,
    letterSpacing: 1,
    marginBottom: 12,
  },
  list: { paddingBottom: 110, gap: 12 },
  deckCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 14,
    gap: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  deckAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  deckIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deckInfo: { flex: 1 },
  deckName: { color: COLORS.textPrimary, fontSize: 15, fontFamily: FONTS.bold, marginBottom: 2 },
  deckMeta: { color: COLORS.textMuted, fontSize: 12, fontFamily: FONTS.medium, marginBottom: 6 },
  deckMaturityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  maturityChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  maturityDot: { width: 7, height: 7, borderRadius: 3.5 },
  maturityText: { color: COLORS.textSecondary, fontSize: 11, fontFamily: FONTS.semiBold },
  deckActions: { alignItems: 'center', gap: 8 },
  dueBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.purpleVibrant,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  dueBadgeText: { color: '#fff', fontSize: 12, fontFamily: FONTS.bold },

  emptyWrap: { alignItems: 'center', paddingTop: 40 },
  emptyIconWrap: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: 'rgba(167,139,250,0.1)',
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 20, fontFamily: FONTS.bold, marginBottom: 8 },
  emptyDesc: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontFamily: FONTS.medium,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  primaryBtn: {
    backgroundColor: COLORS.purplePrimary,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontFamily: FONTS.bold },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(139,92,246,0.15)',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  secondaryBtnText: { color: COLORS.purpleLight, fontSize: 13, fontFamily: FONTS.bold },
  btnDisabled: { opacity: 0.5 },

  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.purpleVibrant,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.purpleVibrant,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },

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
  importCard: { maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { color: COLORS.textPrimary, fontSize: 18, fontFamily: FONTS.extraBold },
  modalSubmit: { marginTop: 20, justifyContent: 'center' },
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
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    color: COLORS.textPrimary,
    fontFamily: FONTS.medium,
  },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  colorSwatch: { width: 34, height: 34, borderRadius: 17 },
  colorSwatchActive: { borderWidth: 3, borderColor: '#fff' },

  importEmpty: { alignItems: 'center', gap: 14, paddingVertical: 16 },
  quizList: { flexGrow: 0, maxHeight: 380 },
  quizRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.bgSecondary,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  quizIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(34,211,238,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quizInfo: { flex: 1 },
  quizTitle: { color: COLORS.textPrimary, fontSize: 14, fontFamily: FONTS.bold, marginBottom: 2 },
  quizMeta: { color: COLORS.textMuted, fontSize: 11, fontFamily: FONTS.medium },
  errorText: { color: COLORS.danger, fontSize: 13, fontFamily: FONTS.medium, marginBottom: 8 },

  searchResults: { marginBottom: 12 },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  resultDot: { width: 10, height: 10, borderRadius: 5 },
  resultInfo: { flex: 1 },
  resultDeck: { color: COLORS.textPrimary, fontSize: 13, fontFamily: FONTS.bold, marginBottom: 3 },
  resultCardText: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONTS.medium },
  resultMore: { color: COLORS.textMuted, fontSize: 11, fontFamily: FONTS.medium, marginTop: 2 },
});
