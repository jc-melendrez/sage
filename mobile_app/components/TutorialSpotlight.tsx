/**
 * Guided, page-moving tutorial.
 *
 * The old tutorial was a modal of static cards: it described the app without
 * ever showing anything. This walks the app instead -- it navigates to the
 * screen a step talks about, dims everything except the one control the step
 * is about, and waits for Back / Proceed.
 *
 * Layout
 *   The provider renders its overlay as a SIBLING AFTER the children, so it
 *   paints above the navigator while still living in the same window. It is
 *   mounted once at the app root (app/_layout.tsx), which is what lets a step
 *   survive tab switches and reach stack screens such as /game.
 *
 * Targets
 *   Screens register controls with `useTutorialTarget(id)`. Measurement runs
 *   on a retry loop after every step change, because the target usually mounts
 *   a beat after the navigation does (list render, tab switch, lazy fetch).
 *
 *   Not rendered inside a <Modal>: RN Modals are separate native windows that
 *   sit above everything in this window, so an overlay drawn here would be
 *   hidden the moment one opened. Steps therefore target the button that opens
 *   a dialog rather than anything inside it.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTutorialTopic, type TutorialStep } from './tutorialSteps';

/** Gap kept between a control and the dimmed edge around it. */
const PAD = 6;
/** How long to wait before the first measurement attempt of a step. */
const FIRST_TRY_DELAY = 450;
/** Retries, at 200ms, before the step gives up and dims the whole screen. */
const MAX_TRIES = 20;

interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TutorialValue {
  active: boolean;
  step: TutorialStep | null;
  stepIndex: number;
  stepCount: number;
  frame: Frame | null;
  start: (topicKey: string) => void;
  stop: () => void;
  next: () => void;
  back: () => void;
  register: (id: string, node: any) => void;
}

const TutorialContext = createContext<TutorialValue | null>(null);

export function useTutorial(): TutorialValue | null {
  return useContext(TutorialContext);
}

/**
 * Ref callback for anything the tutorial should highlight.
 *
 * Pass it straight to `ref` on a host component (View, TouchableOpacity, ...):
 * `const fabRef = useTutorialTarget('activities-fab');` then `ref={fabRef}`.
 */
export function useTutorialTarget(id: string) {
  const ctx = useContext(TutorialContext);
  return useCallback(
    (node: any) => {
      ctx?.register(id, node);
    },
    [ctx, id],
  );
}

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();

  const [topicKey, setTopicKey] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [frame, setFrame] = useState<Frame | null>(null);

  const nodes = useRef(new Map<string, any>());
  // Measures the overlay's own window origin so the target's `measureInWindow`
  // coordinates can be re-based to it. The two live in the same window, so the
  // status-bar / inset offset cancels out instead of shifting every hole.
  const overlayRef = useRef<View>(null);

  const topic = getTutorialTopic(topicKey);
  const stepCount = topic?.steps.length ?? 0;
  const step = topic?.steps[stepIndex] ?? null;
  const active = !!topic && stepCount > 0;
  const isLast = stepIndex >= stepCount - 1;

  const register = useCallback((id: string, node: any) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);

  const start = useCallback((key: string) => {
    setTopicKey(key);
    setStepIndex(0);
    setFrame(null);
  }, []);

  const stop = useCallback(() => {
    setTopicKey(null);
    setStepIndex(0);
    setFrame(null);
  }, []);

  const next = useCallback(() => {
    if (stepIndex + 1 < stepCount) {
      setStepIndex(stepIndex + 1);
      setFrame(null);
    } else {
      stop();
    }
  }, [stepIndex, stepCount, stop]);

  const back = useCallback(() => {
    if (stepIndex > 0) {
      setStepIndex(stepIndex - 1);
      setFrame(null);
    }
  }, [stepIndex]);

  // Navigate to the step's screen, then keep measuring until the target
  // reports a real frame. The retry loop is the whole reason a step can be
  // written for a control that only exists after a fetch resolves.
  useEffect(() => {
    if (!active || !step) return;

    if (step.route) {
      router.push({
        pathname: step.route as any,
        params: (step.params ?? {}) as any,
      });
    }
    setFrame(null);

    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const attempt = () => {
      if (cancelled) return;
      // The overlay is absolute-fill but its top-left is not necessarily the
      // window's top-left (a non-translucent status bar, an inset window). The
      // target's measureInWindow reports window coordinates, so ask the overlay
      // where it sits and subtract that -- anything both share then cancels.
      const base = overlayRef.current;
      if (!base || typeof base.measureInWindow !== 'function') {
        tries += 1;
        if (tries < MAX_TRIES) timer = setTimeout(attempt, 200);
        return;
      }
      base.measureInWindow((ox: number, oy: number, _ow: number, _oh: number) => {
        if (cancelled) return;
        const node = step.targetId ? nodes.current.get(step.targetId) : null;
        if (node && typeof node.measureInWindow === 'function') {
          node.measureInWindow((x: number, y: number, width: number, height: number) => {
            if (cancelled) return;
            if (width > 0 && height > 0) setFrame({ x: x - ox, y: y - oy, width, height });
          });
        }
      });
      tries += 1;
      if (tries < MAX_TRIES) timer = setTimeout(attempt, 200);
    };

    timer = setTimeout(attempt, step.route ? FIRST_TRY_DELAY : 150);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, step, stepIndex, topicKey, router]);

  const value = useMemo<TutorialValue>(
    () => ({ active, step, stepIndex, stepCount, frame, start, stop, next, back, register }),
    [active, step, stepIndex, stepCount, frame, start, stop, next, back, register],
  );

  return (
    <TutorialContext.Provider value={value}>
      {children}
      {active && (
        <Spotlight
          step={step!}
          stepIndex={stepIndex}
          stepCount={stepCount}
          frame={frame}
          overlayRef={overlayRef}
          isLast={isLast}
          onNext={next}
          onBack={back}
          onClose={stop}
          insets={insets}
          winW={winW}
          winH={winH}
        />
      )}
    </TutorialContext.Provider>
  );
}

interface SpotlightProps {
  step: TutorialStep;
  stepIndex: number;
  stepCount: number;
  frame: Frame | null;
  /** The overlay's root view, measured to re-base target frames. */
  overlayRef: React.RefObject<View | null>;
  isLast: boolean;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
  insets: { top: number; bottom: number };
  winW: number;
  winH: number;
}

function Spotlight({
  step,
  stepIndex,
  stepCount,
  frame,
  overlayRef,
  isLast,
  onNext,
  onBack,
  onClose,
  insets,
  winW,
  winH,
}: SpotlightProps) {
  // Clamp the hole to the screen so the four dim rectangles stay
  // non-overlapping: translucent black stacked on itself would show as a
  // visibly darker band along the shared edges.
  const x1 = frame ? Math.max(0, Math.min(winW, frame.x - PAD)) : 0;
  const y1 = frame ? Math.max(0, Math.min(winH, frame.y - PAD)) : 0;
  const x2 = frame ? Math.max(x1, Math.min(winW, frame.x + frame.width + PAD)) : 0;
  const y2 = frame ? Math.max(y1, Math.min(winH, frame.y + frame.height + PAD)) : 0;

  const BUBBLE_MAX = 300;
  const bubbleBelow = !frame || y2 + 190 < winH - insets.bottom;
  const bubbleStyle = frame
    ? bubbleBelow
      ? { top: y2 + 14 }
      : { top: Math.max(insets.top + 8, y1 - 178) }
    : { top: Math.max(insets.top + 8, winH * 0.34) };

  return (
    <View ref={overlayRef} style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Tap sink. Painted first so the dim and the bubble sit above it; it
          exists to stop a stray press falling through the dim onto whatever
          control happens to be underneath. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={() => {}} accessibilityLabel="Tutorial in progress" />

      {frame ? (
        <>
          <View pointerEvents="none" style={[styles.dim, { left: 0, right: 0, top: 0, height: y1 }]} />
          <View pointerEvents="none" style={[styles.dim, { left: 0, right: 0, top: y2, bottom: 0 }]} />
          <View pointerEvents="none" style={[styles.dim, { left: 0, top: y1, width: x1, height: y2 - y1 }]} />
          <View pointerEvents="none" style={[styles.dim, { left: x2, right: 0, top: y1, height: y2 - y1 }]} />
          <View
            pointerEvents="none"
            style={[styles.ring, { left: x1, top: y1, width: x2 - x1, height: y2 - y1 }]}
          />
        </>
      ) : (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim]} />
      )}

      <View style={[styles.bubble, { maxWidth: Math.min(BUBBLE_MAX, winW - 32) }, bubbleStyle]} pointerEvents="auto">
        <Text style={styles.stepCounter}>
          Step {stepIndex + 1} of {stepCount}
        </Text>
        <Text style={styles.title}>{step.title}</Text>
        <Text style={styles.body}>{step.body}</Text>

        <View style={styles.actions}>
          <Pressable
            onPress={onBack}
            disabled={stepIndex === 0}
            style={[styles.btnGhost, stepIndex === 0 && styles.btnGhostDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Previous step"
          >
            <Text style={[styles.btnGhostText, stepIndex === 0 && styles.btnTextDisabled]}>Back</Text>
          </Pressable>

          <View style={styles.actionsRight}>
            <Pressable onPress={onClose} style={styles.btnSkip} accessibilityRole="button" accessibilityLabel="End tutorial">
              <Text style={styles.btnSkipText}>End</Text>
            </Pressable>
            <Pressable
              onPress={onNext}
              style={styles.btnPrimary}
              accessibilityRole="button"
              accessibilityLabel={isLast ? 'Finish tutorial' : 'Next step'}
            >
              <Text style={styles.btnPrimaryText}>{isLast ? 'Done' : 'Proceed'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { position: 'absolute', backgroundColor: 'rgba(10, 6, 24, 0.72)' },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#FDE68A',
    borderStyle: 'dashed',
    borderRadius: 14,
  },
  bubble: {
    position: 'absolute',
    left: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.25)',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  stepCounter: {
    fontSize: 11,
    fontFamily: 'Montserrat-SemiBold',
    color: '#8B5CF6',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  title: { fontSize: 17, fontFamily: 'Montserrat-ExtraBold', color: '#3A107A', marginBottom: 6 },
  body: { fontSize: 14, fontFamily: 'Montserrat-Medium', color: '#6B7280', lineHeight: 20 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    gap: 8,
  },
  actionsRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnGhost: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.2)',
  },
  btnGhostDisabled: { opacity: 0.4 },
  btnGhostText: { fontFamily: 'Montserrat-SemiBold', color: '#3A107A' },
  btnTextDisabled: { color: '#6B7280' },
  btnSkip: { paddingHorizontal: 10, paddingVertical: 10 },
  btnSkipText: { fontFamily: 'Montserrat-SemiBold', color: '#6B7280', fontSize: 13 },
  btnPrimary: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#8B5CF6',
  },
  btnPrimaryText: { fontFamily: 'Montserrat-SemiBold', color: '#FFF' },
});
