import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, EmptyState, Pill } from '@/components/educator/EducatorPrimitives';
import { getCoursePath } from '@/services/courseService';
import { LearningNode, NODE_TYPE_CONFIG } from '@/types/learning';

export default function TopicDetailScreen() {
  const router = useRouter();
  const { topicId, topicName, courseId } = useLocalSearchParams<{ topicId: string; topicName: string; courseId: string }>();
  const tid = Number(topicId);

  const [nodes, setNodes] = useState<LearningNode[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        if (!courseId) { setLoading(false); return; }
        try {
          const data = await getCoursePath(Number(courseId));
          if (!active) return;
          const topic = data.find((t) => t.id === tid);
          setNodes(topic?.nodes || []);
        } catch {
          if (active) Alert.alert('Failed to load nodes');
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => { active = false; };
    }, [courseId, tid])
  );

  return (
    <View style={styles.container}>
      <EducatorHeader
        title={topicName || 'Topic'}
        subtitle={`${nodes.length} node${nodes.length === 1 ? '' : 's'}`}
        showBack
        rightIcon="add"
        onRightPress={() => router.push({
          pathname: '/educator/(tabs)/add-node',
          params: { topicId: tid, order: nodes.length },
        })}
      />

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <SectionHeader title="Nodes" actionLabel="Add" onAction={() => router.push({
          pathname: '/educator/(tabs)/add-node',
          params: { topicId: tid, order: nodes.length },
        })} />

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
          </View>
        ) : nodes.length > 0 ? (
          <View style={{ gap: 12 }}>
            {nodes.map((node, i) => {
              const cfg = NODE_TYPE_CONFIG[node.node_type] || NODE_TYPE_CONFIG.learn;
              return (
                <View key={node.id} style={styles.nodeCard}>
                  <View style={styles.nodeLeft}>
                    <View style={[styles.nodeTypeBadge, { backgroundColor: tint(cfg.color) }]}>
                      <Ionicons name={cfg.icon as any} size={16} color={cfg.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.nodeTitle}>{node.title}</Text>
                      <Text style={styles.nodeMeta}>
                        {cfg.label} · {node.xp_reward} XP · {node.estimated_minutes}min
                        {node.required_score > 0 ? ` · ${node.required_score}% pass` : ''}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.orderBadge}>
                    <Text style={styles.orderText}>{i + 1}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <EmptyState
            icon="cube-outline"
            title="No nodes yet"
            text="Add your first learning node — a lesson, practice quiz, or mastery check."
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  loadingBox: { paddingVertical: 60, alignItems: 'center' },

  nodeCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nodeLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  nodeTypeBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nodeTitle: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  nodeMeta: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },

  orderBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.bgSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orderText: { fontSize: 12, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textMuted },
});
