import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  FlatList,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { API_BASE_URL } from '@/config/api';
import { getToken } from '@/services/authService';
import { updateQuiz, deleteQuiz, shareQuizToGroup, type Quiz } from '@/services/quizService';
import { notify } from '@/services/notify';

const MENU_WIDTH = 168;
const MENU_ITEM_HEIGHT = 44;
const MENU_PADDING = 8;
/** Preview + Edit + Rename + Share + the divider above Delete. */
const MENU_ROWS = 5;
const MENU_ESTIMATED_HEIGHT = MENU_ROWS * MENU_ITEM_HEIGHT + MENU_PADDING * 2;
const EDGE = 8;

type Anchor = { x: number; y: number };

/**
 * Three-dot trigger for a quiz row.
 *
 * Positions itself with `measureInWindow` rather than reading
 * `e.nativeEvent.layout` from the press event — RN does not populate `layout`
 * on press events, so reading it there throws.
 */
export function QuizOverflowButton({
  quiz,
  onOpen,
  style,
}: {
  quiz: Quiz;
  onOpen: (quiz: Quiz, anchor: Anchor) => void;
  style?: object;
}) {
  const ref = useRef<View>(null);

  const openMenu = useCallback(
    (event: { stopPropagation?: () => void }) => {
      // Safe to nest inside a tappable card: never let the parent row open.
      event.stopPropagation?.();
      const node = ref.current;
      if (!node || !node.measureInWindow) return;
      node.measureInWindow((x, y, width, height) => {
        if (!width && !height) return;
        onOpen(quiz, { x: x + width, y: y + height });
      });
    },
    [quiz, onOpen],
  );

  return (
    <TouchableOpacity
      ref={ref as never}
      style={[styles.trigger, style]}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Options for ${quiz.title}`}
      onPress={openMenu}
    >
      <Ionicons name="ellipsis-horizontal" size={24} color={COLORS.textMuted} />
    </TouchableOpacity>
  );
}

type MenuProps = {
  quiz: Quiz | null;
  anchor: Anchor | null;
  onClose: () => void;
  /** Open the read-only detail sheet. Omit to hide the item. */
  onPreview?: (quiz: Quiz) => void;
  /** Open the full editor. Omit to hide the item. */
  onEdit?: (quiz: Quiz) => void;
  /** Called after rename/delete so the list can refresh. */
  onChanged?: () => void | Promise<void>;
};

/**
 * Anchor-positioned quiz options menu (preview / edit / rename / share /
 * delete), plus the rename and share sheets it opens. Render it once near the
 * root of a screen and drive it with `quiz` + `anchor` from
 * {@link QuizOverflowButton}.
 */
export function QuizOverflowMenu({ quiz, anchor, onClose, onPreview, onEdit, onChanged }: MenuProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  // The dropdown closes as soon as an item is picked, so the sheets below keep
  // their own target rather than reading the (now null) `quiz` prop.
  const [renameTarget, setRenameTarget] = useState<Quiz | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [shareTarget, setShareTarget] = useState<Quiz | null>(null);
  const [shareGroups, setShareGroups] = useState<{ id: string; name: string }[] | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(false);

  const openRename = () => {
    if (!quiz) return;
    setRenameTitle(quiz.title);
    setRenameTarget(quiz);
    onClose();
  };

  const submitRename = async () => {
    if (!renameTarget) return;
    const nextTitle = renameTitle.trim();
    if (!nextTitle || nextTitle === renameTarget.title) {
      setRenameTarget(null);
      return;
    }
    setRenaming(true);
    try {
      await updateQuiz(renameTarget.id, { title: nextTitle });
      setRenameTarget(null);
      await onChanged?.();
      notify('Renamed', 'Quiz title updated.');
    } catch (err) {
      console.error('Rename Error:', err);
      notify('Error', err instanceof Error ? err.message : 'Failed to rename quiz');
    } finally {
      setRenaming(false);
    }
  };

  const confirmDelete = () => {
    if (!quiz) return;
    const target = quiz;
    onClose();
    Alert.alert(
      'Delete Quiz',
      `Delete "${target.title}"? This will permanently remove the quiz and its questions.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteQuiz(target.id);
              await onChanged?.();
              // No confirmation existed here, so a successful delete was silent.
              notify('Quiz deleted', `"${target.title}" was removed.`);
            } catch (err) {
              console.error('Delete Error:', err);
              notify('Delete Failed', err instanceof Error ? err.message : 'Something went wrong.');
            }
          },
        },
      ],
    );
  };

  const openShare = async () => {
    if (!quiz) return;
    setShareTarget(quiz);
    setShareGroups([]);
    setLoadingGroups(true);
    onClose();
    try {
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      const res = await fetch(`${API_BASE_URL}/users/groups/mine/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load groups');
      const groups = await res.json();
      setShareGroups(
        (groups as { id: string | number; name: string }[]).map((g) => ({ id: String(g.id), name: g.name })),
      );
    } catch (err) {
      console.error('Share Error:', err);
      setShareTarget(null);
      setShareGroups(null);
      notify('Error', err instanceof Error ? err.message : 'Failed to load groups');
    } finally {
      setLoadingGroups(false);
    }
  };

  const shareToGroup = async (groupId: string, groupName: string) => {
    if (!shareTarget) return;
    const target = shareTarget;
    try {
      // Go through the service instead of hand-rolling the POST. The old
      // request sent the card under `attachments`, but the backend reads a
      // top-level `quiz_embed: { id }` -- so it recorded no QuizGroupShare,
      // posted a plain text message with no quiz card, and because the
      // response was never checked, a 403 still reported "Shared!".
      const result = await shareQuizToGroup(groupId, target.id);
      setShareTarget(null);
      setShareGroups(null);
      notify('Shared!', `"${result.message}" was sent to ${groupName}.`);
    } catch (err) {
      console.error('Share Error:', err);
      setShareTarget(null);
      setShareGroups(null);
      notify('Failed to share', err instanceof Error ? err.message : 'Please try again.');
    }
  };

  // Keep the dropdown fully on screen: flip above the trigger when there isn't
  // room below, and clamp horizontally for triggers near either edge.
  const menuOpen = !!quiz && !!anchor;
  let top = 0;
  let left = 0;
  if (quiz && anchor) {
    const fitsBelow = anchor.y + 6 + MENU_ESTIMATED_HEIGHT <= windowHeight - EDGE;
    top = fitsBelow
      ? anchor.y + 6
      : Math.max(
          EDGE,
          Math.min(anchor.y - MENU_ESTIMATED_HEIGHT - 6, windowHeight - MENU_ESTIMATED_HEIGHT - EDGE),
        );
    left = Math.max(EDGE, Math.min(anchor.x - MENU_WIDTH, windowWidth - MENU_WIDTH - EDGE));
  }

  return (
    <>
      {menuOpen && quiz && (
        <TouchableOpacity style={styles.overlay} onPress={onClose} activeOpacity={1}>
          <View style={[styles.dropdown, { left, top }]}>
            {onPreview && (
              <TouchableOpacity
                style={styles.item}
                onPress={() => {
                  onClose();
                  onPreview(quiz);
                }}
              >
                <Ionicons name="eye-outline" size={18} color={COLORS.textPrimary} style={styles.itemIcon} />
                <Text style={styles.itemText}>Preview</Text>
              </TouchableOpacity>
            )}
            {onEdit && (
              <TouchableOpacity
                style={styles.item}
                onPress={() => {
                  onClose();
                  onEdit(quiz);
                }}
              >
                <Ionicons name="create-outline" size={18} color={COLORS.textPrimary} style={styles.itemIcon} />
                <Text style={styles.itemText}>Edit</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.item} onPress={openRename}>
              <Ionicons name="pencil-outline" size={18} color={COLORS.textPrimary} style={styles.itemIcon} />
              <Text style={styles.itemText}>Rename</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.item} onPress={openShare}>
              <Ionicons name="share-outline" size={18} color={COLORS.purplePrimary} style={styles.itemIcon} />
              <Text style={[styles.itemText, { color: COLORS.purplePrimary }]}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.item, styles.itemDanger]} onPress={confirmDelete}>
              <Ionicons name="trash-outline" size={18} color={COLORS.danger} style={styles.itemIcon} />
              <Text style={[styles.itemText, { color: COLORS.danger }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}

      {/* Rename */}
      <Modal
        visible={!!renameTarget}
        animationType="fade"
        transparent
        onRequestClose={() => setRenameTarget(null)}
      >
        <View style={styles.renameOverlay}>
          <View style={styles.renameCard}>
            <Text style={styles.renameTitle}>Rename Quiz</Text>
            <TextInput
              style={styles.renameInput}
              value={renameTitle}
              onChangeText={setRenameTitle}
              placeholder="Quiz title"
              placeholderTextColor={COLORS.textMuted}
              autoFocus
            />
            <View style={styles.renameActions}>
              <TouchableOpacity style={styles.renameCancel} onPress={() => setRenameTarget(null)}>
                <Text style={styles.renameCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.renameConfirm, renaming && { opacity: 0.6 }]}
                onPress={submitRename}
                disabled={renaming}
              >
                <Text style={styles.renameConfirmText}>{renaming ? 'Saving' : 'Rename'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Share */}
      <Modal
        visible={!!shareTarget}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setShareTarget(null);
          setShareGroups(null);
        }}
      >
        <View style={styles.shareOverlay}>
          <View style={styles.shareCard}>
            <View style={styles.shareHeader}>
              <Text style={styles.shareTitle}>Share Quiz</Text>
              <TouchableOpacity
                onPress={() => {
                  setShareTarget(null);
                  setShareGroups(null);
                }}
              >
                <Ionicons name="close" size={24} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.shareSubtitle}>Select a study group to share this quiz with</Text>
            {loadingGroups ? (
              <View style={styles.shareEmpty}>
                <Ionicons name="people-outline" size={32} color={COLORS.textMuted} />
                <Text style={styles.shareEmptyText}>Loading groups...</Text>
              </View>
            ) : shareGroups && shareGroups.length === 0 ? (
              <View style={styles.shareEmpty}>
                <Ionicons name="people-outline" size={32} color={COLORS.textMuted} />
                <Text style={styles.shareEmptyText}>No study groups found</Text>
                <Text style={styles.shareEmptySub}>Create or join a group first</Text>
              </View>
            ) : (
              <FlatList
                data={shareGroups ?? []}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.groupItem} onPress={() => shareToGroup(item.id, item.name)} activeOpacity={0.7}>
                    <View style={styles.groupItemIcon}>
                      <Ionicons name="people-outline" size={20} color={COLORS.purplePrimary} />
                    </View>
                    <Text style={styles.groupItemName}>{item.name}</Text>
                    <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                  </TouchableOpacity>
                )}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.groupList}
              />
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { padding: 8 },

  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 },
  dropdown: {
    position: 'absolute',
    backgroundColor: 'white',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: MENU_PADDING,
    width: MENU_WIDTH,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, height: MENU_ITEM_HEIGHT, paddingHorizontal: 14 },
  itemIcon: { width: 24 },
  itemText: { fontSize: 14, fontFamily: FONTS.medium, fontWeight: '600', color: COLORS.textPrimary },
  itemDanger: { borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 4 },

  renameOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  renameCard: { backgroundColor: 'white', borderRadius: RADIUS.xl, padding: 24, width: '85%', maxWidth: 360 },
  renameTitle: { fontSize: 18, fontFamily: FONTS.bold, color: COLORS.textPrimary, marginBottom: 16, textAlign: 'center' },
  renameInput: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  renameActions: { flexDirection: 'row', gap: 12 },
  renameCancel: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.sm,
    paddingVertical: 12,
    alignItems: 'center',
  },
  renameCancelText: { fontSize: 14, fontFamily: FONTS.semiBold, color: COLORS.textSecondary },
  renameConfirm: {
    flex: 1,
    backgroundColor: COLORS.purplePrimary,
    borderRadius: RADIUS.sm,
    paddingVertical: 12,
    alignItems: 'center',
  },
  renameConfirmText: { fontSize: 14, fontFamily: FONTS.bold, color: 'white' },

  shareOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  shareCard: {
    backgroundColor: 'white',
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '80%',
  },
  shareHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  shareTitle: { fontSize: 20, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  shareSubtitle: { fontSize: 14, color: COLORS.textMuted, marginBottom: 20 },
  shareEmpty: { alignItems: 'center', paddingVertical: 40 },
  shareEmptyText: { fontSize: 16, fontFamily: FONTS.semiBold, color: COLORS.textSecondary, marginTop: 12 },
  shareEmptySub: { fontSize: 14, color: COLORS.textMuted, marginTop: 4 },
  groupList: { gap: 8 },
  groupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  groupItemIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: tint(COLORS.purplePrimary),
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  groupItemName: { flex: 1, fontSize: 16, fontFamily: FONTS.semiBold, color: COLORS.textPrimary },
});
