import { useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Dimensions, Modal, Pressable } from 'react-native';
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
const PATH_W = Math.min(SCREEN_W - 20, 400);
const NODE_SIZE = 70; // Slightly bigger for touch targets
const ROW_H = 110; // Vertical spacing between nodes
const AMP = PATH_W / 2 - 60; // Horizontal swing amplitude

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

export default function TopicPathScreen() {
  const { topicId, courseId, title } = useLocalSearchParams<{ topicId: string; courseId: string; title: string }>();
  const router = useRouter();
  const [nodes, setNodes] = useState<LearningNode[]>([]);
  const [topicTitle, setTopicTitle] = useState(title || 'Topic');
  const [loading, setLoading] = useState(true);
  
  // State for the popup card
  const [selectedNodeIndex, setSelectedNodeIndex] = useState<number | null>(null);

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
    const node = nodes[index];
    const status = getNodeStatus(node, index, nodes);
    
    if (status === 'locked') return; // Do nothing or shake animation
    
    // Toggle selection: if tapping same node, close it. If new node, open it.
    if (selectedNodeIndex === index) {
      setSelectedNodeIndex(null);
    } else {
      setSelectedNodeIndex(index);
    }
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
  const selectedStatus = selectedNodeIndex !== null ? statuses[selectedNodeIndex] : null;

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
        {nodes.map((node, i) => {
          const status = statuses[i];
          const cfg = NODE_TYPE_CONFIG[node.node_type];
          const x = getNodeX(i);
          const y = getNodeY(i);
          const isSelected = selectedNodeIndex === i;

          return (
            <View key={node.id}>
              {/* Glow for current node */}
              {status === 'current' && (
                <View style={[
                  styles.glow, 
                  { left: x - (NODE_SIZE + 20)/2, top: y - (NODE_SIZE + 20)/2, backgroundColor: cfg.color }
                ]} />
              )}

              {/* The Circle Button */}
              <TouchableOpacity
                style={[
                  styles.nodeBtn,
                  { left: x - NODE_SIZE/2, top: y - NODE_SIZE/2 },
                  status === 'locked' && styles.nodeLocked,
                  isSelected && styles.nodeSelected
                ]}
                disabled={status === 'locked'}
                onPress={() => handleNodePress(i)}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={
                    status === 'completed' ? ['#10B981', '#059669'] :
                    status === 'current' ? [cfg.color, cfg.color + 'CC'] :
                    ['#CBD5E1', '#94A3B8']
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.nodeCircle}
                >
                   <Ionicons
                    name={
                      status === 'completed' ? 'checkmark' :
                      status === 'locked' ? 'lock-closed' :
                      (cfg.icon as any)
                    }
                    size={status === 'current' ? 32 : 28}
                    color="white"
                  />
                </LinearGradient>
                
                {/* Selection Ring */}
                {isSelected && (
                  <View style={[styles.selectionRing, { borderColor: cfg.color }]} />
                )}
              </TouchableOpacity>
            </View>
          );
        })}

        {/* Trophy at the end */}
        {nodes.length > 0 && (
           <View style={[styles.trophyWrap, { left: PATH_W/2 - 40, top: getNodeY(nodes.length) }]}>
             <LinearGradient colors={['#F59E0B', '#D97706']} style={styles.trophyCircle}>
               <Ionicons name="trophy" size={32} color="white" />
             </LinearGradient>
           </View>
        )}
      </ScrollView>

      {/* --- POPUP CARD MODAL --- */}
      {/* We use a Modal-like overlay that sits on top, but positioned absolutely relative to the screen */}
      {selectedNode && (
        <Pressable style={styles.overlay} onPress={() => setSelectedNodeIndex(null)}>
           <View 
             style={[
               styles.popupCard, 
               { 
                 // Position the card near the node, but keep it on screen
                 top: Math.min(Math.max(getNodeY(selectedNodeIndex!) - 160, 100), contentHeight - 200),
                 left: Math.min(Math.max(getNodeX(selectedNodeIndex!) - 140, 20), PATH_W - 300),
                 borderColor: NODE_TYPE_CONFIG[selectedNode.node_type].color
               }
             ]}
           >
             {/* Stop propagation so clicking card doesn't close it */}
             <Pressable onPress={(e) => e.stopPropagation()}>
                <View style={styles.popupHeader}>
                  <View style={[styles.typeBadge, { backgroundColor: NODE_TYPE_CONFIG[selectedNode.node_type].color + '20' }]}>
                    <Text style={[styles.typeText, { color: NODE_TYPE_CONFIG[selectedNode.node_type].color }]}>
                      {NODE_TYPE_CONFIG[selectedNode.node_type].label}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedNodeIndex(null)}>
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
                </View>

                <TouchableOpacity 
                  style={[styles.startBtn, { backgroundColor: NODE_TYPE_CONFIG[selectedNode.node_type].color }]}
                  onPress={() => handleStartActivity(selectedNode.id)}
                >
                  <Text style={styles.startBtnText}>
                    {selectedStatus === 'completed' ? 'Review' : 'Start'}
                  </Text>
                  <Ionicons name="arrow-forward" size={18} color="white" />
                </TouchableOpacity>
             </Pressable>
           </View>
        </Pressable>
      )}
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
  glow: {
    position: 'absolute',
    width: NODE_SIZE + 20,
    height: NODE_SIZE + 20,
    borderRadius: (NODE_SIZE + 20) / 2,
    opacity: 0.3,
    zIndex: 0,
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
  nodeSelected: {
    transform: [{ scale: 1.1 }],
    zIndex: 10,
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
    width: 280,
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