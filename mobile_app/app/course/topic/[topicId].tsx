import { useState, useCallback, useRef, useEffect, type ComponentRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Dimensions, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSpring,
  withDelay,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getCoursePath } from '@/services/courseService';
import { LearningNode, NODE_TYPE_CONFIG } from '@/types/learning';

// --- Modern palette: deeper, richer violets + a warm accent pair -----------
const COLORS = {
  bgTop: '#2E1065',
  bgMid: '#5B21B6',
  bgBottom: '#EDE9FE',
  surface: '#FFFFFF',
  surfaceTint: '#F5F3FF',
  purpleDeep: '#3B0F70',
  purpleDark: '#6D28D9',
  purpleVibrant: '#8B5CF6',
  accent: '#22D3EE',
  accentPink: '#F472B6',
  success: '#10B981',
  successDeep: '#047857',
  warning: '#F59E0B',
  textPrimary: '#1E1533',
  textSecondary: '#6B6580',
  textMuted: '#A79FC2',
  textOnDark: 'rgba(255,255,255,0.92)',
  textOnDarkMuted: 'rgba(255,255,255,0.62)',
  border: 'rgba(76,29,149,0.10)',
  glassBorder: 'rgba(255,255,255,0.35)',
  shadow: 'rgba(46,16,101,0.35)',
  trailDone: '#8B5CF6',
  trailLocked: 'rgba(107,101,128,0.28)',
};

const FONTS = {
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

// --- Geometry ---
const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const HEADER_H = 128;
const PATH_W = Math.min(SCREEN_W - 20, 400);
const NODE_SIZE = 72;
const ROW_H = 116; // Vertical spacing between nodes
const AMP = PATH_W / 2 - 62; // Horizontal swing amplitude

// Popup bubble
const POPUP_W = 288;
const POPUP_H_EST = 300;
const TAIL = 14;

// Calculate X position based on index (Sine wave pattern)
const getNodeX = (index: number) => {
  return PATH_W / 2 + Math.sin(index * 0.8) * AMP;
};

// Calculate Y position
const getNodeY = (index: number) => {
  return index * ROW_H + 90;
};

function getNodeStatus(node: LearningNode, index: number, allNodes: LearningNode[]): 'completed' | 'current' | 'locked' {
  if (node.progress?.passed) return 'completed';
  const allPriorCompleted = allNodes.slice(0, index).every(n => n.progress?.passed);
  if (allPriorCompleted) return 'current';
  return 'locked';
}

// --- Dotted trail connecting consecutive nodes along the sine path ---------
const TRAIL_DOTS_PER_SEGMENT = 7;
const TRAIL_DOT_SIZE = 5;

function TrailSegment({ from, to, done }: { from: { x: number; y: number }; to: { x: number; y: number }; done: boolean }) {
  const dots = [];
  for (let i = 1; i < TRAIL_DOTS_PER_SEGMENT; i++) {
    const t = i / TRAIL_DOTS_PER_SEGMENT;
    // ease along the curve slightly so dots hug the sine swing, not a straight line
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    dots.push(
      <View
        key={i}
        style={[
          styles.trailDot,
          {
            left: x - TRAIL_DOT_SIZE / 2,
            top: y - TRAIL_DOT_SIZE / 2,
            backgroundColor: done ? COLORS.trailDone : COLORS.trailLocked,
            opacity: done ? 0.55 : 0.7,
          },
        ]}
      />
    );
  }
  return <>{dots}</>;
}

// --- Modern node button ------------------------------------------------
const RING_SIZE = NODE_SIZE + 16;
const RIPPLE_SIZE = NODE_SIZE + 14;

function shade(hex: string, amount: number): string {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw;
  const num = parseInt(full.slice(0, 6), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, v + amount));
  return `rgb(${ch(num >> 16)},${ch((num >> 8) & 0xff)},${ch(num & 0xff)})`;
}

type NodeButtonProps = {
  node: LearningNode;
  status: 'completed' | 'current' | 'locked';
  selected: boolean;
  x: number;
  y: number;
  onPress: () => void;
  onMeasure: (cx: number, cy: number) => void;
};

function NodeButton({ node, status, selected, x, y, onPress, onMeasure }: NodeButtonProps) {
  const cfg = NODE_TYPE_CONFIG[node.node_type];
  const color = cfg.color;
  const R = NODE_SIZE / 2;
  const isCurrent = status === 'current';

  const btnRef = useRef<ComponentRef<typeof TouchableOpacity> | null>(null);
  const pressed = useSharedValue(0);
  const pulse = useSharedValue(0);
  const spin = useSharedValue(0);
  const rippleA = useSharedValue(0);
  const rippleB = useSharedValue(0);

  useEffect(() => {
    if (isCurrent) {
      pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }), -1, true);
      spin.value = withRepeat(withTiming(1, { duration: 6000, easing: Easing.linear }), -1, false);
      rippleA.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1);
      rippleB.value = withDelay(1200, withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1));
    } else {
      cancelAnimation(pulse);
      cancelAnimation(spin);
      cancelAnimation(rippleA);
      cancelAnimation(rippleB);
      pulse.value = 0;
      spin.value = 0;
    }
  }, [isCurrent, pulse, spin, rippleA, rippleB]);

  const faceStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: pressed.value * 3 },
      { scale: 1 - pressed.value * 0.04 + pulse.value * 0.04 },
    ],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.92 + pulse.value * 0.22 }],
    opacity: 0.35 - pulse.value * 0.18,
  }));

  const rippleStyleA = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + rippleA.value * 0.65 }],
    opacity: 0.32 * (1 - rippleA.value),
  }));

  const rippleStyleB = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + rippleB.value * 0.65 }],
    opacity: 0.32 * (1 - rippleB.value),
  }));

  const handleMeasure = useCallback(() => {
    btnRef.current?.measureInWindow((mx, my, mw, mh) => {
      if (mh > 0) onMeasure(mx + mw / 2, my + mh / 2);
    });
  }, [onMeasure]);

  const shadowColor =
    status === 'completed' ? COLORS.successDeep
    : status === 'locked' ? 'transparent'
    : shade(color, -30);

  return (
    <TouchableOpacity
      ref={(r) => { btnRef.current = r; }}
      onLayout={handleMeasure}
      onPressIn={() => { pressed.value = withTiming(1, { duration: 90 }); }}
      onPressOut={() => { pressed.value = withSpring(0, { damping: 14, stiffness: 240 }); }}
      onPress={onPress}
      activeOpacity={1}
      style={[
        styles.nodeBtn,
        { left: x - R, top: y - R, shadowColor },
        status === 'locked' && styles.nodeLocked,
        selected && styles.nodeSelected,
      ]}
    >
      {/* Ripple rings emanating from the active node */}
      {isCurrent && (
        <>
          <Animated.View pointerEvents="none" style={[styles.ripple, { borderColor: color }, rippleStyleA]} />
          <Animated.View pointerEvents="none" style={[styles.ripple, { borderColor: color }, rippleStyleB]} />
        </>
      )}

      {/* Soft breathing glow behind the active node */}
      {isCurrent && (
        <Animated.View pointerEvents="none" style={[styles.glowChild, { backgroundColor: color }, glowStyle]} />
      )}

      {/* Slow-rotating gradient ring outline for the active node */}
      {isCurrent && (
        <Animated.View pointerEvents="none" style={[styles.rotatingRing, ringStyle]}>
          <LinearGradient
            colors={[color, 'transparent', color]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.rotatingRingGradient}
          />
        </Animated.View>
      )}

      {/* Frosted base disc for depth (replaces the old flat 3D edge) */}
      <View
        style={[
          styles.nodeBase,
          {
            backgroundColor: status === 'locked' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.55)',
          },
        ]}
      />

      <Animated.View style={[styles.faceWrap, faceStyle]}>
        <LinearGradient
          colors={
            status === 'completed' ? [COLORS.success, COLORS.successDeep]
            : status === 'current' ? [shade(color, 18), color]
            : ['#E4E1F0', '#C9C3E0']
          }
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={[styles.nodeCircle, status === 'locked' && styles.nodeCircleLocked]}
        >
          <Ionicons
            name={cfg.icon as any}
            size={isCurrent ? 30 : 25}
            color={status === 'locked' ? COLORS.textMuted : 'white'}
          />
        </LinearGradient>

        {status === 'completed' && (
          <View style={styles.badgeCheck}>
            <Ionicons name="checkmark" size={13} color="white" />
          </View>
        )}
        {status === 'locked' && (
          <View style={styles.badgeLock}>
            <Ionicons name="lock-closed" size={10} color="white" />
          </View>
        )}
      </Animated.View>

      {selected && (
        <View style={[styles.selectionRing, { borderColor: color }]} />
      )}
    </TouchableOpacity>
  );
}

export default function TopicPathScreen() {
  const { topicId, courseId, title } = useLocalSearchParams<{ topicId: string; courseId: string; title: string }>();
  const router = useRouter();
  const [nodes, setNodes] = useState<LearningNode[]>([]);
  const [topicTitle, setTopicTitle] = useState(title || 'Topic');
  const [loading, setLoading] = useState(true);

  const [selectedNodeIndex, setSelectedNodeIndex] = useState<number | null>(null);
  const [nodeCenters, setNodeCenters] = useState<Record<number, { cx: number; cy: number }>>({});

  useFocusEffect(
    useCallback(() => {
      loadNodes();
    }, [topicId])
  );

  const loadNodes = async () => {
    try {
      setLoading(true);
      const pathData = await getCoursePath(Number(courseId));
      const topic = pathData.find(t => t.id === Number(topicId));
      if (topic) {
        setNodes(topic.nodes);
        setTopicTitle(topic.title);
      }
    } catch {
      // Handle error silently or with toast
    } finally {
      setLoading(false);
    }
  };

  const handleNodePress = (index: number) => {
    setSelectedNodeIndex(prev => (prev === index ? null : index));
  };

  const handleStartActivity = (nodeId: number) => {
    setSelectedNodeIndex(null);
    router.push(`/course/node/${nodeId}` as any);
  };

  const statuses = nodes.map((n, i) => getNodeStatus(n, i, nodes));
  const completedCount = statuses.filter(s => s === 'completed').length;
  const progressPct = nodes.length > 0 ? completedCount / nodes.length : 0;

  const contentHeight = nodes.length > 0 ? getNodeY(nodes.length) + 100 : 400;

  if (loading) {
    return (
      <LinearGradient colors={[COLORS.bgTop, COLORS.bgMid, COLORS.bgBottom]} style={styles.center}>
        <ActivityIndicator size="large" color="#FFFFFF" />
      </LinearGradient>
    );
  }

  const selectedNode = selectedNodeIndex !== null ? nodes[selectedNodeIndex] : null;

  return (
    <LinearGradient colors={[COLORS.bgTop, COLORS.bgMid, COLORS.bgBottom]} locations={[0, 0.32, 0.75]} style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color="white" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>{topicTitle}</Text>
            <Text style={styles.headerSub}>{completedCount} of {nodes.length} activities</Text>
          </View>
          <View style={{ width: 34 }} />
        </View>

        <View style={styles.progressTrack}>
          <LinearGradient
            colors={[COLORS.accent, COLORS.purpleVibrant, COLORS.accentPink]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.progressFill, { width: `${Math.max(progressPct * 100, nodes.length ? 4 : 0)}%` }]}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { height: contentHeight }]}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={() => setSelectedNodeIndex(null)}
      >
        {nodes.length === 0 && (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="construct-outline" size={40} color={COLORS.purpleVibrant} />
            </View>
            <Text style={styles.emptyTitle}>No activities yet</Text>
            <Text style={styles.emptySub}>Check back soon — this topic is being built.</Text>
          </View>
        )}

        {/* Dotted trail connecting each node along the path */}
        {nodes.slice(0, -1).map((node, i) => (
          <TrailSegment
            key={`trail-${node.id}`}
            from={{ x: getNodeX(i), y: getNodeY(i) }}
            to={{ x: getNodeX(i + 1), y: getNodeY(i + 1) }}
            done={statuses[i] === 'completed'}
          />
        ))}
        {nodes.length > 0 && (
          <TrailSegment
            from={{ x: getNodeX(nodes.length - 1), y: getNodeY(nodes.length - 1) }}
            to={{ x: PATH_W / 2, y: getNodeY(nodes.length) + 32 }}
            done={statuses[nodes.length - 1] === 'completed'}
          />
        )}

        {/* The Path Nodes */}
        {nodes.map((node, i) => (
          <NodeButton
            key={node.id}
            node={node}
            status={statuses[i]}
            selected={selectedNodeIndex === i}
            x={getNodeX(i)}
            y={getNodeY(i)}
            onPress={() => handleNodePress(i)}
            onMeasure={(cx, cy) =>
              setNodeCenters(prev => ({ ...prev, [node.id]: { cx, cy } }))
            }
          />
        ))}

        {/* Trophy at the end */}
        {nodes.length > 0 && (
          <View style={[styles.trophyWrap, { left: PATH_W / 2 - 42, top: getNodeY(nodes.length) }]}>
            <View style={styles.trophyGlow} />
            <LinearGradient colors={['#FBBF24', '#F59E0B', '#D97706']} style={styles.trophyCircle}>
              <Ionicons name="trophy" size={30} color="white" />
            </LinearGradient>
          </View>
        )}
      </ScrollView>

      {/* --- SPEECH BUBBLE POPUP --- */}
      {selectedNode && selectedNodeIndex !== null && (() => {
        const cfg = NODE_TYPE_CONFIG[selectedNode.node_type];
        const st = statuses[selectedNodeIndex];
        const R = NODE_SIZE / 2;

        const { cx, cy } = nodeCenters[selectedNode.id] ?? { cx: getNodeX(selectedNodeIndex), cy: getNodeY(selectedNodeIndex) };

        const fitsBelow = cy + R + 5 + POPUP_H_EST < SCREEN_H;
        const above = !fitsBelow;
        const popupTop = above
          ? Math.max(cy - R - 5 - POPUP_H_EST, HEADER_H + 8)
          : Math.min(cy + R + 5, SCREEN_H - POPUP_H_EST);
        const popupLeft = Math.min(Math.max(cx - POPUP_W / 2, 12), SCREEN_W - POPUP_W - 12);

        const tailLeft = Math.min(Math.max(cx - popupLeft - TAIL / 2, 16), POPUP_W - 16 - TAIL);

        const startLabel =
          st === 'completed' ? 'Review'
          : selectedNode.progress && !selectedNode.progress.passed ? 'Retry'
          : 'Start';

        return (
          <Pressable style={styles.overlay} onPress={() => setSelectedNodeIndex(null)}>
            <View
              style={[
                styles.popupCard,
                { top: popupTop, left: popupLeft, opacity: st === 'locked' ? 0.96 : 1 },
              ]}
            >
              <LinearGradient
                colors={[cfg.color + '14', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 0.6 }}
                style={StyleSheet.absoluteFillObject}
                pointerEvents="none"
              />

              <View
                style={[
                  styles.popupTail,
                  above
                    ? { bottom: -(TAIL / 2), borderBottomWidth: 1, borderRightWidth: 1 }
                    : { top: -(TAIL / 2), borderTopWidth: 1, borderLeftWidth: 1 },
                  { borderColor: COLORS.glassBorder },
                  { left: tailLeft },
                ]}
              />

              <Pressable onPress={(e) => e.stopPropagation()}>
                <View style={styles.popupHeader}>
                  <View style={[styles.typeBadge, { backgroundColor: cfg.color + '1F' }]}>
                    <Ionicons name={cfg.icon as any} size={12} color={cfg.color} />
                    <Text style={[styles.typeText, { color: cfg.color }]}>{cfg.label}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedNodeIndex(null)} hitSlop={8} style={styles.closeBtn}>
                    <Ionicons name="close" size={17} color={COLORS.textMuted} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.popupTitle}>{selectedNode.title}</Text>
                <Text style={styles.popupDesc} numberOfLines={3}>
                  {selectedNode.description || 'Tap start to begin this activity.'}
                </Text>

                <View style={styles.popupMeta}>
                  <View style={styles.metaItem}>
                    <Ionicons name="time-outline" size={14} color={COLORS.textSecondary} />
                    <Text style={styles.metaText}>{selectedNode.estimated_minutes} min</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Ionicons name="star" size={14} color={COLORS.warning} />
                    <Text style={styles.metaText}>{selectedNode.xp_reward} XP</Text>
                  </View>
                  {selectedNode.progress?.score !== undefined && selectedNode.progress.score > 0 && (
                    <View style={[styles.scorePill, selectedNode.progress.passed ? styles.scorePillPass : styles.scorePillFail]}>
                      <Text style={[styles.scorePillText, { color: selectedNode.progress.passed ? COLORS.success : COLORS.warning }]}>
                        {selectedNode.progress.score}%
                      </Text>
                    </View>
                  )}
                </View>

                {st === 'locked' ? (
                  <View style={styles.lockNotice}>
                    <Ionicons name="lock-closed" size={15} color={COLORS.textMuted} />
                    <Text style={styles.lockNoticeText}>Complete previous activities to unlock</Text>
                  </View>
                ) : (
                  <TouchableOpacity activeOpacity={0.9} onPress={() => handleStartActivity(selectedNode.id)}>
                    <LinearGradient
                      colors={[shade(cfg.color, 14), cfg.color]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.startBtn}
                    >
                      <Text style={styles.startBtnText}>{startLabel}</Text>
                      <Ionicons name="arrow-forward" size={18} color="white" />
                    </LinearGradient>
                  </TouchableOpacity>
                )}
              </Pressable>
            </View>
          </Pressable>
        );
      })()}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Header
  header: {
    paddingTop: 52,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  backBtn: {
    padding: 6,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.14)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: { alignItems: 'center', flex: 1 },
  headerTitle: { color: COLORS.textOnDark, fontSize: 17, fontFamily: FONTS.extraBold, fontWeight: '800' },
  headerSub: { color: COLORS.textOnDarkMuted, fontSize: 12, fontFamily: FONTS.medium, marginTop: 3 },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },

  // Scroll & Path
  scrollContent: {
    paddingTop: 24,
    paddingBottom: 70,
  },
  emptyState: { alignItems: 'center', paddingVertical: 90, gap: 10, paddingHorizontal: 40 },
  emptyIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(139,92,246,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 17, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  emptySub: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textSecondary, textAlign: 'center' },

  // Trail
  trailDot: {
    position: 'absolute',
    width: TRAIL_DOT_SIZE,
    height: TRAIL_DOT_SIZE,
    borderRadius: TRAIL_DOT_SIZE / 2,
    zIndex: 1,
  },

  // Nodes
  ripple: {
    position: 'absolute',
    left: -(RIPPLE_SIZE - NODE_SIZE) / 2,
    top: -(RIPPLE_SIZE - NODE_SIZE) / 2,
    width: RIPPLE_SIZE,
    height: RIPPLE_SIZE,
    borderRadius: RIPPLE_SIZE / 2,
    borderWidth: 2.5,
  },
  glowChild: {
    position: 'absolute',
    left: -12,
    top: -12,
    width: NODE_SIZE + 24,
    height: NODE_SIZE + 24,
    borderRadius: (NODE_SIZE + 24) / 2,
  },
  rotatingRing: {
    position: 'absolute',
    left: -(RING_SIZE - NODE_SIZE) / 2,
    top: -(RING_SIZE - NODE_SIZE) / 2,
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    overflow: 'hidden',
  },
  rotatingRingGradient: {
    width: '100%',
    height: '100%',
    borderRadius: RING_SIZE / 2,
  },
  nodeBtn: {
    position: 'absolute',
    zIndex: 2,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 6,
  },
  nodeLocked: { opacity: 0.6 },
  nodeBase: {
    position: 'absolute',
    left: -4,
    top: -4,
    width: NODE_SIZE + 8,
    height: NODE_SIZE + 8,
    borderRadius: (NODE_SIZE + 8) / 2,
  },
  badgeCheck: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.success,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },
  badgeLock: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#9691AE',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },
  nodeSelected: {
    transform: [{ scale: 1.08 }],
    zIndex: 10,
  },
  faceWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: NODE_SIZE,
    height: NODE_SIZE,
  },
  nodeCircle: {
    width: NODE_SIZE,
    height: NODE_SIZE,
    borderRadius: NODE_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  nodeCircleLocked: {
    borderColor: 'rgba(255,255,255,0.6)',
  },
  selectionRing: {
    position: 'absolute',
    top: -9, left: -9, right: -9, bottom: -9,
    borderRadius: (NODE_SIZE + 18) / 2,
    borderWidth: 2.5,
    borderStyle: 'dashed',
    opacity: 0.85,
  },

  // Trophy
  trophyWrap: {
    position: 'absolute',
    width: 84,
    alignItems: 'center',
  },
  trophyGlow: {
    position: 'absolute',
    top: -6,
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(251,191,36,0.35)',
  },
  trophyCircle: {
    width: 64, height: 64, borderRadius: 32,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.5)',
    shadowColor: '#F59E0B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 5,
  },

  // Popup Overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    zIndex: 100,
  },

  // Popup Card
  popupCard: {
    position: 'absolute',
    width: POPUP_W,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 26,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 12,
    overflow: 'hidden',
  },
  popupTail: {
    position: 'absolute',
    width: TAIL,
    height: TAIL,
    backgroundColor: '#FFFFFF',
    transform: [{ rotate: '45deg' }],
    elevation: 10,
  },
  popupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  typeText: {
    fontSize: 11,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  closeBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(148,163,184,0.14)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  popupTitle: {
    fontSize: 19,
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
    marginBottom: 8,
    lineHeight: 25,
  },
  popupDesc: {
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.textSecondary,
    marginBottom: 16,
    lineHeight: 20,
  },
  popupMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.surfaceTint,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
  },
  metaText: {
    fontSize: 12.5,
    fontFamily: FONTS.semiBold,
    color: COLORS.textSecondary,
  },
  scorePill: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
    marginLeft: 'auto',
  },
  scorePillPass: { backgroundColor: 'rgba(16,185,129,0.12)' },
  scorePillFail: { backgroundColor: 'rgba(245,158,11,0.12)' },
  scorePillText: {
    fontSize: 12,
    fontFamily: FONTS.bold,
  },
  lockNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(148,163,184,0.14)',
  },
  lockNoticeText: {
    fontSize: 13,
    fontFamily: FONTS.semiBold,
    color: COLORS.textMuted,
    flexShrink: 1,
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 16,
    gap: 8,
  },
  startBtnText: {
    color: 'white',
    fontSize: 16,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
});