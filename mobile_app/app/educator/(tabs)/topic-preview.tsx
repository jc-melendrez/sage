import { useLocalSearchParams, useRouter } from 'expo-router';
import TopicPathView from '@/components/courses/TopicPathView';

export default function EducatorTopicPreview() {
  const { topicId, courseId, title } = useLocalSearchParams<{
    topicId: string;
    courseId: string;
    title?: string;
  }>();
  const router = useRouter();

  return (
    <TopicPathView
      topicId={Number(topicId)}
      courseId={Number(courseId)}
      title={title}
      isPreview
      onBack={() => router.back()}
      onOpenNode={(nodeId) =>
        router.push({
          pathname: '/educator/(tabs)/node-preview',
          params: { nodeId: String(nodeId) },
        } as any)
      }
    />
  );
}
