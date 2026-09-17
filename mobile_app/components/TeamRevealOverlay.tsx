import { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions, Animated, Easing } from 'react-native';

const { width: W, height: H } = Dimensions.get('window');

const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

interface Assignment {
  id: string;
  displayName: string;
  teamId: string;
  teamName?: string;
  teamColor?: string;
}

interface TeamRevealOverlayProps {
  assignments: Assignment[];
  myUserId?: string | number | null;
  onComplete: () => void;
}

export default function TeamRevealOverlay({ assignments, myUserId, onComplete }: TeamRevealOverlayProps) {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const titleAnim = useRef(new Animated.Value(0)).current;

  const teams = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    assignments.forEach(a => {
      const arr = map.get(a.teamId) || [];
      arr.push(a);
      map.set(a.teamId, arr);
    });
    return Array.from(map.entries())
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([id, players]) => ({
        id,
        players,
        color: players[0]?.teamColor || '#22D3EE',
        name: players[0]?.teamName || `Team ${id}`,
      }));
  }, [assignments]);

  const teamCount = teams.length;
  const colW = W / teamCount;

  const rowOf = useMemo<Record<string, { x: number; y: number }>>(() => {
    const chipW = Math.min(colW - 14, 150);
    const chipH = 34;
    const rowGap = 12;
    const headerH = 52;
    const topY = H * 0.30 + headerH + 8;
    const rowH = chipH + rowGap;
    const rows: Record<string, { x: number; y: number }> = {};
    teams.forEach((team, ti) => {
      team.players.forEach((p, pi) => {
        rows[p.id] = { x: (ti + 0.5) * colW - chipW / 2, y: topY + pi * rowH - chipH / 2 };
      });
    });
    return rows;
  }, [teams, colW]);

  const chips = useRef(
    assignments.map(() => ({
      tx: new Animated.Value(0),
      ty: new Animated.Value(0),
      scale: new Animated.Value(0.4),
      op: new Animated.Value(0),
      rot: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    Animated.timing(titleAnim, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();

    assignments.forEach((a, i) => {
      const seed = (i * 7919) % 1000;
      const startX = W / 2 + ((seed % 200) - 100);
      const startY = H * 0.42 + (((seed >> 3) % 120) - 60);
      const rotDeg = ((seed % 3) - 1) * 14;
      const slot = rowOf[a.id] || { x: W / 2, y: H * 0.42 };
      const chip = chips[i];

      chip.tx.setValue(startX - slot.x);
      chip.ty.setValue(startY - slot.y);
      chip.rot.setValue((rotDeg * Math.PI) / 180);

      timers.push(
        setTimeout(() => {
          Animated.parallel([
            Animated.timing(chip.tx, { toValue: 0, duration: 430, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
            Animated.timing(chip.ty, { toValue: 0, duration: 430, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
            Animated.spring(chip.scale, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }),
            Animated.timing(chip.op, { toValue: 1, duration: 260, useNativeDriver: true }),
            Animated.timing(chip.rot, { toValue: 0, duration: 460, useNativeDriver: true }),
          ]).start();
        }, 380 + i * 165)
      );
    });

    const lastDelay = 380 + assignments.length * 165;
    timers.push(
      setTimeout(() => {
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 650,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }).start(() => onCompleteRef.current());
      }, lastDelay + 950)
    );

    return () => {
      timers.forEach(t => clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const titleStyle = {
    opacity: titleAnim,
    transform: [
      { translateY: titleAnim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
      { scale: titleAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
    ],
  };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { opacity: overlayOpacity }]}>
      <Animated.View style={[styles.titleBlock, titleStyle]}>
        <Text style={styles.emoji}>🎲</Text>
        <Text style={styles.title}>TEAMS ASSIGNED</Text>
        <Text style={styles.subtitle}>Shuffled randomly — good luck!</Text>
      </Animated.View>

      <View style={styles.teamsArea}>
        {teams.map((team, ti) => (
          <View key={team.id} style={[styles.column, { width: colW, left: ti * colW }]}>
            <View style={[styles.columnHeader, { backgroundColor: team.color + '22', borderColor: team.color }]}>
              <View style={[styles.columnDot, { backgroundColor: team.color }]} />
              <Text style={styles.columnName} numberOfLines={1} adjustsFontSizeToFit>
                {team.name}
              </Text>
            </View>
            {ti < teamCount - 1 && <View style={[styles.columnDivider, { borderLeftColor: team.color + '33' }]} />}
          </View>
        ))}

        {assignments.map((a, i) => {
          const slot = rowOf[a.id] || { x: W / 2, y: H * 0.42 };
          const chip = chips[i];
          const color = a.teamColor || '#22D3EE';
          const isYou = String(a.id) === String(myUserId);
          return (
            <Animated.View
              key={a.id}
              style={[
                styles.chip,
                { left: slot.x, top: slot.y, borderColor: color, backgroundColor: color + '14' },
                isYou && styles.chipYou,
                {
                  opacity: chip.op,
                  transform: [
                    { translateX: chip.tx },
                    { translateY: chip.ty },
                    { scale: chip.scale },
                    { rotate: chip.rot },
                  ],
                },
              ]}
            >
              <View style={[styles.chipDot, { backgroundColor: color }]} />
              <Text style={styles.chipName} numberOfLines={1} adjustsFontSizeToFit>
                {a.displayName}
              </Text>
              {isYou && <Text style={styles.chipYouTag}>YOU</Text>}
            </Animated.View>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: 'rgba(15, 12, 41, 0.98)',
    zIndex: 100,
    alignItems: 'center',
    paddingTop: 90,
  },
  titleBlock: {
    alignItems: 'center',
  },
  emoji: {
    fontSize: 44,
    marginBottom: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 30,
    fontFamily: FONTS.black,
    letterSpacing: 1.5,
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 14,
    fontFamily: FONTS.semiBold,
    marginTop: 8,
  },
  teamsArea: {
    position: 'absolute',
    top: H * 0.30,
    left: 0,
    right: 0,
    bottom: 0,
  },
  column: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 110,
    maxWidth: '82%',
    alignSelf: 'center',
  },
  columnDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  columnName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: FONTS.extraBold,
    letterSpacing: 0.5,
  },
  columnDivider: {
    position: 'absolute',
    top: 68,
    bottom: 40,
    left: 0,
    borderLeftWidth: 1,
  },
  chip: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 8,
    maxWidth: 155,
  },
  chipYou: {
    borderWidth: 2,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: FONTS.bold,
    flexShrink: 1,
  },
  chipYouTag: {
    color: '#FBBF24',
    fontSize: 10,
    fontFamily: FONTS.black,
    marginLeft: 2,
  },
});