import { useLocalSearchParams, useRouter } from 'expo-router';
import NodePlayerView from '@/components/courses/NodePlayerView';

export default function NodePlayerScreen() {
  const { nodeId, preview, courseId, next } = useLocalSearchParams<{
    nodeId: string;
    preview?: string;
    courseId?: string;
    /** Id of the following node, sent by the path screen that opened this one. */
    next?: string;
  }>();
  const router = useRouter();

  const nextNodeId = next ? Number(next) : null;
  // Both params are needed: `next` is the node to advance to, `courseId` is the
  // path to advance along. Without both there is no Next button -- which is the
  // correct outcome for a node opened outside a path.
  const canAdvance =
    !preview && courseId != null && nextNodeId != null && Number.isFinite(nextNodeId);

  return (
    <NodePlayerView
      nodeId={Number(nodeId)}
      isPreview={preview === '1'}
      onBack={() => router.back()}
      onNext={
        canAdvance
          ? () => router.replace(`/course/path/${courseId}?openNode=${nextNodeId}`)
          : undefined
      }
    />
  );
}
