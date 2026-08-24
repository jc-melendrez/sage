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

const COLORS = {
  bg: '#baaeda',
  surface: '#FFFFFF', // Cards should be white for contrast
  purpleDeep: '#4C1D95',
  purpleDark: '#6D28D9',
  purpleVibrant: '#8B5CF6',
  accent: '#22D3EE',
  success: '#10B981',
  warning: '#F59E0B',
  textPrimary: '#1F2937',
  textSecondary: '#6B7280',
  textMuted: '#94A3B8',
  border: 'rgba(0, 0, 0, 0.1)',
  shadow: 'rgba(76, 29, 149, 0.2)',
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
const HEADER_H = 90;
const PATH_W = Math.min(SCREEN_W - 20, 400);
const NODE_SIZE = 70; // Slightly bigger for touch targets
const ROW_H = 110; // Vertical spacing between nodes
const AMP = PATH_W / 2 - 60; // Horizontal swing amplitude

// Popup bubble
const POPUP_W = 280;
const POPUP_H_EST = 285;
const TAIL = 14;

// Calculate X position based on index (Sine wave pattern)
const getNodeX = (index: number) => {
  return PATH_W / 2 + Math.sin(index * 0.8) * AMP;
};

// Calculate Y position
const getNodeY = (index: number) => {
  return index * ROW_H + 80; // Start lower to clear header
};

function getNodeStatus(node: LearningNode, index: number, allNodes: LearningNode[]): 'completed' | 'current' | 'locked' {
  if (node.progress?.passed) return 'completed';
  const allPriorCompleted = allNodes.slice(0, index).every(n => n.progress?.passed);
  if (allPriorCompleted) return 'current';
  return 'locked';
}

// --- 3D animated node button ---
const EDGE = 6; // height of the visible "side" under each button face
const RIPPLE_SIZE = NODE_SIZE + 12;

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
  const rippleA = useSharedValue(0);
  const rippleB = useSharedValue(0);

  useEffect(() => {
    if (isCurrent) {
      // Breathing pulse
      pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true);
      // Two ripple rings, staggered half a cycle apart
      rippleA.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }), -1);
      rippleB.value = withDelay(1100, withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }), -1));
    } else {
      cancelAnimation(pulse);
      cancelAnimation(rippleA);
      cancelAnimation(rippleB);
      pulse.value = 0;
    }
  }, [isCurrent, pulse, rippleA, rippleB]);

  // Button face: slides down when pressed, breathes when current
  const faceStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: pressed.value * 4 },
      { scale: 1 + pulse.value * 0.05 },
    ],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.9 + pulse.value * 0.25 }],
    opacity: 0.32 - pulse.value * 0.18,
  }));

  const rippleStyleA = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + rippleA.value * 0.7 }],
    opacity: 0.4 * (1 - rippleA.value),
  }));

  const rippleStyleB = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + rippleB.value * 0.7 }],
    opacity: 0.4 * (1 - rippleB.value),
  }));

  const handleMeasure = useCallback(() => {
    btnRef.current?.measureInWindow((mx, my, mw, mh) => {
      if (mh > 0) onMeasure(mx + mw / 2, my + mh / 2);
    });
  }, [onMeasure]);

  const edgeColor =
    status === 'completed' ? '#047857'
    : status === 'locked' ? '#64748B'
    : shade(color, -45);

  return (
    <TouchableOpacity
      ref={(r) => { btnRef.current = r; }}
      onLayout={handleMeasure}
      onPressIn={() => { pressed.value = withTiming(1, { duration: 90 }); }}
      onPressOut={() => { pressed.value = withSpring(0, { damping: 12, stiffness: 220 }); }}
      onPress={onPress}
      activeOpacity={1}
      style={[
        styles.nodeBtn,
        { left: x - R, top: y - R },
        status === 'locked' && styles.nodeLocked,
        selected && styles.nodeSelected,
      ]}
    >
      {/* Ripple rings emanating from current node */}
      {isCurrent && (
        <>
          <Animated.View pointerEvents="none" style={[styles.ripple, { borderColor: color }, rippleStyleA]} />
          <Animated.View pointerEvents="none" style={[styles.ripple, { borderColor: color }, rippleStyleB]} />
        </>
      )}

      {/* Breathing glow behind current node */}
      {isCurrent && (
        <Animated.View pointerEvents="none" style={[styles.glowChild, { backgroundColor: color }, glowStyle]} />
      )}

      {/* 3D side (base peeking out under the face) */}
      <View style={[styles.nodeEdge, { backgroundColor: edgeColor }]} />

      {/* Button face (slides down on press, carrying icon + badges) */}
      <Animated.View style={[styles.faceWrap, faceStyle]}>
        <LinearGradient
          colors={
            status === 'completed' ? ['#10B981', '#059669']
            : status === 'current' ? [color, color + 'CC']
            : ['#CBD5E1', '#94A3B8']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.nodeCircle}
        >
          <Ionicons name={cfg.icon as any} size={isCurrent ? 32 : 26} color="white" />
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

      {/* Selection Ring */}
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
  
  // State for the popup card
  const [selectedNodeIndex, setSelectedNodeIndex] = useState<number | null>(null);
  // Real on-screen center of each circle (measured), so the bubble anchors exactly
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
    // Toggle selection: if tapping same node, close it. If new node, open it.
    // Locked nodes also open a bubble (explaining how to unlock).
    setSelectedNodeIndex(prev => (prev === index ? null : index));
  };

  const handleStartActivity = (nodeId: number) => {
    setSelectedNodeIndex(null); // Close popup
    router.push(`/course/node/${nodeId}` as any);
  };

  const statuses = nodes.map((n, i) => getNodeStatus(n, i, nodes));
  const completedCount = statuses.filter(s => s === 'completed').length;
  
  // Calculate total height for the scroll view
  const contentHeight = nodes.length > 0 ? getNodeY(nodes.length) + 100 : 400;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.purpleDark} />
      </View>
    );
  }

  const selectedNode = selectedNodeIndex !== null ? nodes[selectedNodeIndex] : null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient colors={[COLORS.purpleDeep, COLORS.purpleDark]} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="white" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{topicTitle}</Text>
          <Text style={styles.headerSub}>{completedCount}/{nodes.length} completed</Text>
        </View>
        <View style={{ width: 32 }} />
      </LinearGradient>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { height: contentHeight }]}
        showsVerticalScrollIndicator={false}
        // Close popup when scrolling
        onScrollBeginDrag={() => setSelectedNodeIndex(null)}
      >
        {nodes.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="construct-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>No activities yet</Text>
          </View>
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
           <View style={[styles.trophyWrap, { left: PATH_W/2 - 40, top: getNodeY(nodes.length) }]}>
             <LinearGradient colors={['#F59E0B', '#D97706']} style={styles.trophyCircle}>
               <Ionicons name="trophy" size={32} color="white" />
             </LinearGradient>
           </View>
        )}
      </ScrollView>

      {/* --- SPEECH BUBBLE POPUP --- */}
      {selectedNode && selectedNodeIndex !== null && (() => {
        const cfg = NODE_TYPE_CONFIG[selectedNode.node_type];
        const st = statuses[selectedNodeIndex];
        const R = NODE_SIZE / 2;

        // Measured on-screen center of the tapped circle (fallback to computed)
        const { cx, cy } = nodeCenters[selectedNode.id] ?? { cx: getNodeX(selectedNodeIndex), cy: getNodeY(selectedNodeIndex) };

        // The tail tip reaches ~10px past the card edge; sink it ~5px into the
        // circle's area so bubble and circle look physically connected.
        const fitsBelow = cy + R + 5 + POPUP_H_EST < SCREEN_H;
        const above = !fitsBelow;
        const popupTop = above
          ? Math.max(cy - R - 5 - POPUP_H_EST, HEADER_H + 8)
          : Math.min(cy + R + 5, SCREEN_H - POPUP_H_EST);
        const popupLeft = Math.min(Math.max(cx - POPUP_W / 2, 12), SCREEN_W - POPUP_W - 12);

        // Tail points at the circle's x, clamped inside the card bounds
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
                {
                  top: popupTop,
                  left: popupLeft,
                  borderColor: cfg.color,
                  opacity: st === 'locked' ? 0.92 : 1,
                },
              ]}
            >
              {/* Comic bubble tail pointing at the circle */}
              <View
                style={[
                  styles.popupTail,
                  above
                    ? { bottom: -(TAIL / 2), borderBottomWidth: 2, borderRightWidth: 2 }
                    : { top: -(TAIL / 2), borderTopWidth: 2, borderLeftWidth: 2 },
                  { borderColor: cfg.color },
                  { left: tailLeft },
                ]}
              />

              {/* Stop propagation so clicking card doesn't close it */}
              <Pressable onPress={(e) => e.stopPropagation()}>
                <View style={styles.popupHeader}>
                  <View style={[styles.typeBadge, { backgroundColor: cfg.color + '20' }]}>
                    <Ionicons name={cfg.icon as any} size={12} color={cfg.color} />
                    <Text style={[styles.typeText, { color: cfg.color }]}>{cfg.label}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedNodeIndex(null)} hitSlop={8}>
                    <Ionicons name="close" size={20} color={COLORS.textMuted} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.popupTitle}>{selectedNode.title}</Text>
                <Text style={styles.popupDesc} numberOfLines={3}>
                  {selectedNode.description || "Tap start to begin this activity."}
                </Text>

                <View style={styles.popupMeta}>
                   <View style={styles.metaItem}>
                     <Ionicons name="time-outline" size={14} color={COLORS.textSecondary} />
                     <Text style={styles.metaText}>{selectedNode.estimated_minutes} min</Text>
                   </View>
                   <View style={styles.metaItem}>
                     <Ionicons name="star-outline" size={14} color={COLORS.warning} />
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
                  <TouchableOpacity
                    style={[styles.startBtn, { backgroundColor: cfg.color }]}
                    onPress={() => handleStartActivity(selectedNode.id)}
                  >
                    <Text style={styles.startBtnText}>{startLabel}</Text>
                    <Ionicons name="arrow-forward" size={18} color="white" />
                  </TouchableOpacity>
                )}
             </Pressable>
            </View>
          </Pressable>
        );
      })()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' },
  
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 48,
    paddingBottom: 18,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    zIndex: 10,
  },
  backBtn: { padding: 6, width: 36, alignItems: 'center' },
  headerCenter: { alignItems: 'center', flex: 1 },
  headerTitle: { color: 'white', fontSize: 17, fontFamily: FONTS.extraBold, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontFamily: FONTS.medium, marginTop: 2 },
  
  // Scroll & Path
  scrollContent: {
    paddingTop: 20,
    paddingBottom: 60,
    // alignItems: 'center', // Removed because we use absolute positioning for X
  },
  emptyState: { alignItems: 'center', paddingVertical: 80, gap: 10 },
  emptyTitle: { fontSize: 17, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  
  // Nodes
  ripple: {
    position: 'absolute',
    left: -(RIPPLE_SIZE - NODE_SIZE) / 2,
    top: -(RIPPLE_SIZE - NODE_SIZE) / 2,
    width: RIPPLE_SIZE,
    height: RIPPLE_SIZE,
    borderRadius: RIPPLE_SIZE / 2,
    borderWidth: 3,
  },
  glowChild: {
    position: 'absolute',
    left: -10,
    top: -10,
    width: NODE_SIZE + 20,
    height: NODE_SIZE + 20,
    borderRadius: (NODE_SIZE + 20) / 2,
  },
  nodeBtn: {
    position: 'absolute',
    zIndex: 2,
    // Shadow for depth
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  nodeLocked: { opacity: 0.5 },
  badgeCheck: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.success,
    borderWidth: 2,
    borderColor: COLORS.bg,
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
    backgroundColor: '#64748B',
    borderWidth: 2,
    borderColor: COLORS.bg,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },
  nodeSelected: {
    transform: [{ scale: 1.1 }],
    zIndex: 10,
  },
  nodeEdge: {
    position: 'absolute',
    left: 0,
    top: EDGE,
    width: NODE_SIZE,
    height: NODE_SIZE,
    borderRadius: NODE_SIZE / 2,
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
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.3)', // Inner ring effect
  },
  selectionRing: {
    position: 'absolute',
    top: -8, left: -8, right: -8, bottom: -8,
    borderRadius: (NODE_SIZE + 16) / 2,
    borderWidth: 3,
    borderStyle: 'dashed',
    opacity: 0.8,
  },

  // Trophy
  trophyWrap: {
    position: 'absolute',
    width: 80,
    alignItems: 'center',
  },
  trophyCircle: { 
    width: 64, height: 64, borderRadius: 32, 
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#F59E0B', shadowOffset: {width:0, height:4}, shadowOpacity: 0.4, shadowRadius: 8, elevation: 5
  },

  // Popup Overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent', // Transparent overlay to catch taps
    zIndex: 100,
  },
  
  // Popup Card
  popupCard: {
    position: 'absolute',
    width: POPUP_W,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  popupTail: {
    position: 'absolute',
    width: TAIL,
    height: TAIL,
    backgroundColor: COLORS.surface,
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
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  typeText: {
    fontSize: 11,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  popupTitle: {
    fontSize: 18,
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
    marginBottom: 8,
    lineHeight: 24,
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
    gap: 16,
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 13,
    fontFamily: FONTS.semiBold,
    color: COLORS.textSecondary,
  },
  scorePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
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
    borderRadius: 14,
    backgroundColor: 'rgba(148,163,184,0.15)',
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
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  startBtnText: {
    color: 'white',
    fontSize: 16,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
});