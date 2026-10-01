import { useLocalSearchParams } from 'expo-router';
import NodePlayerView from '@/components/courses/NodePlayerView';
import { useEducatorBack } from '@/hooks/useEducatorBack';

export default function EducatorNodePreview() {
  const { nodeId } = useLocalSearchParams<{ nodeId: string }>();
  const goBack = useEducatorBack();

  return (
    <NodePlayerView
      nodeId={Number(nodeId)}
      isPreview
      onBack={goBack}
    />
  );
}
