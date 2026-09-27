import { useLocalSearchParams, useRouter } from 'expo-router';
import NodePlayerView from '@/components/courses/NodePlayerView';

export default function EducatorNodePreview() {
  const { nodeId } = useLocalSearchParams<{ nodeId: string }>();
  const router = useRouter();

  return (
    <NodePlayerView
      nodeId={Number(nodeId)}
      isPreview
      onBack={() => router.back()}
    />
  );
}
