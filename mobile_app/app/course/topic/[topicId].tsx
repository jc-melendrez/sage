import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getCoursePath } from '@/services/courseService';
import { CoursePathTopic, LearningNode, NODE_TYPE_CONFIG, NodeType } from '@/types/learning';

const COLORS = {
  bg: '#baaeda',
  surface: '#cdc2dd',
  purpleDeep: '#4C1D95',
  purpleDark: '#6D28D9',
  purpleVibrant: '#8B5CF6',
  accent: '#22D3EE',
  success: '#10B981',
  warning: '#F59E0B',
  textPrimary: '#3a107a',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  border: 'rgba(44, 29, 0, 0.15)',
};

const FONTS = {
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
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
    } finally {
      setLoading(false);
    }
  };

  const handleNodePress = (node: LearningNode, index: number) => {
    const status = getNodeStatus(node, index, nodes);
    if (status === 'locked') return;
    router.push(`/course/node/${node.id}` as any);
  };

  const completedCount = nodes.filter((n, i) => getNodeStatus(n, i, nodes) === 'completed').length;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.purpleDark} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
        contentContainerStyle={styles.pathContainer}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* Empty state */}
        {nodes.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="construct-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>No activities yet</Text>
            <Text style={styles.emptySub}>Activities will appear here soon.</Text>
          </View>
        )}

        {/* Vertical path */}
        {nodes.map((node, index) => {
          const status = getNodeStatus(node, index, nodes);
          const cfg = NODE_TYPE_CONFIG[node.node_type];
          const isFirst = index === 0;
          const isLast = index === nodes.length - 1;

          return (
            <View key={node.id} style={styles.nodeRow}>
              {/* Connector above */}
              {!isFirst && (
                <View style={[
                  styles.connector,
                  { backgroundColor: status === 'completed' ? COLORS.success : 'rgba(124,58,237,0.15)' },
                ]} />
              )}

              {/* The node */}
              <TouchableOpacity
                style={[
                  styles.nodeWrap,
                  status === 'locked' && styles.nodeWrapLocked,
                ]}
                disabled={status === 'locked'}
                onPress={() => handleNodePress(node, index)}
                activeOpacity={0.8}
              >
                {status === 'current' && <View style={[styles.glow, { backgroundColor: cfg.color }]} />}

                <LinearGradient
                  colors={
                    status === 'completed'
                      ? ['#10B981', '#059669']
                      : status === 'current'
                      ? [cfg.color, cfg.color + 'CC']
                      : ['#CBD5E1', '#94A3B8']
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.nodeCircle}
                >
                  <Ionicons
                    name={
                      status === 'completed' ? 'checkmark' as const
                      : (cfg.icon as any)
                    }
                    size={status === 'completed' ? 22 : 24}
                    color="white"
                  />
                </LinearGradient>

                {/* Label card */}
                <View style={styles.labelCard}>
                  <View style={styles.labelTop}>
                    <View style={[styles.typeBadge, { backgroundColor: cfg.color + '20' }]}>
                      <Ionicons name={cfg.icon as any} size={11} color={cfg.color} />
                      <Text style={[styles.typeText, { color: cfg.color }]}>{cfg.label}</Text>
                    </View>
                    {node.estimated_minutes > 0 && (
                      <Text style={styles.timeText}>{node.estimated_minutes}m</Text>
                    )}
                  </View>
                  <Text style={[
                    styles.nodeTitle,
                    status === 'locked' && { color: COLORS.textMuted },
                  ]} numberOfLines={2}>
                    {node.title}
                  </Text>
                  {status === 'locked' && (
                    <View style={styles.lockRow}>
                      <Ionicons name="lock-closed" size={10} color={COLORS.textMuted} />
                      <Text style={styles.lockText}>Complete previous activities</Text>
                    </View>
                  )}
                  {node.progress?.score !== undefined && node.progress.score > 0 && (
                    <View style={[styles.scorePill, node.progress.passed ? styles.scorePillPass : styles.scorePillFail]}>
                      <Text style={[styles.scoreText, node.progress.passed ? { color: COLORS.success } : { color: COLORS.warning }]}>
                        {node.progress.score}%
                      </Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>

              {/* Connector below (last item gets a trophy) */}
              {isLast && (
                <View style={styles.connector} />
              )}
              {isLast && (
                <View style={styles.trophyWrap}>
                  <LinearGradient colors={['#EAB308', '#CA8A04']} style={styles.trophyCircle}>
                    <Ionicons name="trophy" size={22} color="white" />
                  </LinearGradient>
                  <Text style={styles.trophyLabel}>Topic Complete!</Text>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const NODE_SIZE = 64;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 48,
    paddingBottom: 18,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  backBtn: { padding: 6, width: 36, alignItems: 'center' },
  headerCenter: { alignItems: 'center', flex: 1 },
  headerTitle: { color: 'white', fontSize: 17, fontFamily: FONTS.extraBold, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontFamily: FONTS.medium, marginTop: 2 },
  pathContainer: {
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 60,
    alignItems: 'center',
  },
  emptyState: { alignItems: 'center', paddingVertical: 80, gap: 10 },
  emptyTitle: { fontSize: 17, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  emptySub: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textMuted, textAlign: 'center' },
  nodeRow: { alignItems: 'center', width: '100%', maxWidth: 360 },
  connector: { width: 3, height: 32, borderRadius: 1.5 },
  nodeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 8,
    width: '100%',
  },
  nodeWrapLocked: { opacity: 0.45 },
  glow: {
    position: 'absolute',
    left: -4,
    top: 6,
    width: NODE_SIZE + 8,
    height: NODE_SIZE + 8,
    borderRadius: (NODE_SIZE + 8) / 2,
    opacity: 0.18,
  },
  nodeCircle: {
    width: NODE_SIZE,
    height: NODE_SIZE,
    borderRadius: NODE_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4C1D95',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  labelCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  labelTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  typeText: { fontSize: 10, fontFamily: FONTS.semiBold, fontWeight: '700' },
  timeText: { fontSize: 10, fontFamily: FONTS.medium, color: COLORS.textMuted, marginLeft: 'auto' },
  nodeTitle: { fontSize: 13, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, lineHeight: 18 },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  lockText: { fontSize: 10, fontFamily: FONTS.medium, color: COLORS.textMuted },
  scorePill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, marginTop: 6 },
  scorePillPass: { backgroundColor: 'rgba(16,185,129,0.12)' },
  scorePillFail: { backgroundColor: 'rgba(245,158,11,0.12)' },
  scoreText: { fontSize: 11, fontFamily: FONTS.bold },
  trophyWrap: { alignItems: 'center', marginTop: 4, gap: 6 },
  trophyCircle: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  trophyLabel: { fontSize: 13, fontFamily: FONTS.extraBold, color: '#CA8A04' },
});
