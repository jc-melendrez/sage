import WizardOwl from '@/components/WizardOwl'; // Adjust path if needed
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  StatusBar,
  Dimensions,
  Alert,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  type SharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import LessonDisplay from './LessonDisplay';
import LessonGenerator from './LessonGenerator';
import NotificationSheet from './NotificationSheet';
import { getCurrentUser } from '@/services/authService';
import { useCurrentUser } from '@/contexts/UserContext';
import { apiCall } from '@/services/apiClient';
import { isRateLimitError } from '@/services/aiLimits';
import { dailyCheckIn } from '@/services/gamificationService';
import BottomSheet from './BottomSheet';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// --- Carousel dimensions ---
const CAROUSEL_PAGE_WIDTH = SCREEN_WIDTH - 72;
const AUTO_SLIDE_INTERVAL = 4000; // Increased to 4 seconds for better readability

// 🎨 Colors
const COLORS = {
  bg: '#FFFFFF',
  bgSecondary: '#F4F2FA',
  surface: '#FFFFFF',
  surfaceLight: '#5A4F6C',
  purpleDeep: '#4C1D95',
  purpleDark: '#6D28D9',
  purplePrimary: '#7C3AED',
  purpleVibrant: '#8B5CF6',
  purpleLight: '#A78BFA',
  purplePale: '#C4B5FD',
  purpleGhost: '#DDD6FE',
  accent: '#22D3EE',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  textPrimary: '#3a107a',
  textSecondary: '#CBD5E1',
  textMuted: '#6B7280',
  border: 'rgba(44, 29, 0, 0.15)',
};

const FONTS = {
  black: 'Montserrat-Black',
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
  regular: 'Montserrat-Regular',
};

interface User {
  id: number;
  name?: string;
  first_name?: string;
  username?: string;
  streak?: number;
  level?: number;
  total_points?: number;
  role?: string;
}
interface Badge {
  id: number;
  icon_url?: string;
  icon?: string;
  name: string;
  /** Criteria for earning it, resolved server-side from the badge name. */
  description?: string;
  earned_at?: string;
  course_name?: string | null;
}
interface Recommendation {
  id: number;
  title: string;
  description: string;
  /** Course this recommendation is about, when the backend could resolve one. */
  course_id?: number | null;
  /** Specific topic inside that course; `href` already carries it as ?topicId=. */
  topic_id?: number | null;
  /** Server-computed deep link, already carrying ?topicId= when known. */
  href?: string | null;
}
interface Activity {
  id: number;
  title: string;
  description: string;
  activity_type: string;
  kind?: string;
  xp_earned?: number;
  course_name?: string;
  payload?: { route?: string } | null;
  created_at?: string;
}

const ACTIVITY_META: Record<string, { icon: any; color: string }> = {
  quiz: { icon: 'book', color: COLORS.purpleVibrant },
  lesson: { icon: 'checkmark-circle', color: COLORS.success },
  checkin: { icon: 'flame', color: COLORS.warning },
  game: { icon: 'trophy', color: '#F59E0B' },
  offline_game: { icon: 'game-controller', color: COLORS.accent },
  other: { icon: 'time', color: COLORS.textMuted },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function DotIndicator({ index, scrollX }: { index: number; scrollX: SharedValue<number> }) {
  const animatedStyle = useAnimatedStyle(() => {
    const inputRange = [
      (index - 1) * CAROUSEL_PAGE_WIDTH,
      index * CAROUSEL_PAGE_WIDTH,
      (index + 1) * CAROUSEL_PAGE_WIDTH,
    ];
    const width = interpolate(scrollX.value, inputRange, [7, 18, 7], 'clamp');
    const opacity = interpolate(scrollX.value, inputRange, [0.4, 1, 0.4], 'clamp');
    return { width, opacity };
  });

  return <Animated.View style={[styles.dot, animatedStyle, { backgroundColor: 'white' }]} />;
}

export default function Dashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<User | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [lesson, setLesson] = useState<any>(null);
  const [showLessonGenerator, setShowLessonGenerator] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Carousel state
  const [currentPage, setCurrentPage] = useState(0);
  const currentPageRef = useRef(0);
  const scrollViewRef = useRef<ScrollView>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { setUser: publishUser } = useCurrentUser();
  const autoSlideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const refreshingRecs = useRef(false);
  
  // Animation value for smooth dot transition
  const scrollX = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
  });

  const streakCount = user?.streak || 0;

  const featurePages = [
    {
      id: 'streak',
      icon: 'flame',
      title: 'Day Streak',
      description: `${streakCount} days ${streakCount > 0 ? '– keep it up! 🔥' : '– start your journey today!'}`,
      color: '#FBBF24',
      route: null,
    },
    {
      id: 'quiz',
      icon: 'game-controller',
      title: 'Play a Quiz',
      description: 'Join or create a quiz room and challenge friends in real‑time.',
      color: '#F59E0B',
      route: '/games',
    },
    {
      id: 'assistant',
      icon: 'chatbubbles',
      title: 'AI Assistant',
      description: 'Ask SAGE anything – get instant help and explanations.',
      color: '#22D3EE',
      route: '/ai-assistant',
    },
    {
      id: 'groups',
      icon: 'people',
      title: 'Study Groups',
      description: 'Collaborate with friends, share materials, and learn together.',
      color: '#10B981',
      route: '/activities',
    },
  ];

  // --- Auto-slide Logic ---
  const scrollToPage = (pageIndex: number) => {
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollTo({
        x: pageIndex * CAROUSEL_PAGE_WIDTH,
        animated: true,
      });
      currentPageRef.current = pageIndex;
      setCurrentPage(pageIndex);
    }
  };

  const startAutoSlide = () => {
    if (autoSlideTimerRef.current) clearInterval(autoSlideTimerRef.current);
    autoSlideTimerRef.current = setInterval(() => {
      const nextPage = (currentPageRef.current + 1) % featurePages.length;
      scrollToPage(nextPage);
    }, AUTO_SLIDE_INTERVAL);
  };

  const stopAutoSlide = () => {
    if (autoSlideTimerRef.current) {
      clearInterval(autoSlideTimerRef.current);
      autoSlideTimerRef.current = null;
    }
  };

  // Handle user scroll end (Snap logic)
  const handleMomentumScrollEnd = (event: any) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const page = Math.round(offsetX / CAROUSEL_PAGE_WIDTH);
    
    // Update state
    if (page !== currentPageRef.current) {
      currentPageRef.current = page;
      setCurrentPage(page);
    }
    
    // Reset timer
    stopAutoSlide();
    startAutoSlide();
  };

  useEffect(() => {
    startAutoSlide();
    return () => stopAutoSlide();
  }, []);

  useEffect(() => {
    stopAutoSlide();
    startAutoSlide();
  }, [featurePages.length]);

  // --- Data fetching ---
  // `force` is what pull-to-refresh uses: it skips the cache *read* but still
  // writes the response, so the next mount is not served the pre-refresh copy.
  const fetchUserData = useCallback(async (force = false) => {
    try {
      setError(null);
      const opts = force ? { refresh: true } : {};
      const userProfile = force
        ? await getCurrentUser({ refresh: true })
        : await getCurrentUser();      if (!userProfile || !userProfile.id) {
        setError('Session expired. Please log in again.');
        return;
      }
      setUser(userProfile);
      publishUser(userProfile);
      const realUserId = userProfile.id;

      if (userProfile.badges) {
        setBadges(userProfile.badges);
      } else {
        setBadges(await apiCall<Badge[]>(`/users/${realUserId}/badges/`, opts));
      }

      // A single GET. This used to escalate to a POST whenever the list came
      // back empty, which meant every dashboard mount with no cards stored
      // forced a provider call -- and because a failed generation stores
      // nothing, "empty" stayed true forever, so every mount retried. The
      // server now auto-generates on GET behind a cooldown marker, so the GET
      // alone is enough and the escalation is no longer needed.
      const recs = await apiCall<Recommendation[]>(`/users/${realUserId}/recommendations/`, opts);
      setRecommendations(recs);
      setActivities(await apiCall<Activity[]>(`/users/${realUserId}/activities/`, opts));
    } catch (err) {
      const rawError = err instanceof Error ? err : new Error('An error occurred');
      const isNetworkError =
        rawError.name === 'TypeError' || /Network request failed/i.test(rawError.message);
      console.error('Error fetching data:', rawError);
      setError(isNetworkError ? "You're offline. Check your connection and try again." : rawError.message);
    } finally {
      setLoading(false);
    }
  }, [publishUser]);

  // Pull to refresh: force a live read of everything this screen shows.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchUserData(true);
    } finally {
      setRefreshing(false);
    }
  }, [fetchUserData]);

  // Daily check-in (once per session)
  const checkInRanRef = useRef(false);
  useEffect(() => {
    if (checkInRanRef.current) return;
    checkInRanRef.current = true;
    dailyCheckIn()
      .then((result) => {
        if (result.checked_in) {
          const streakText = result.streak > 1 ? `${result.streak} day streak!` : 'Your streak begins today!';
          Alert.alert('Daily Check-In 🔥', `+${result.xp} XP · ${streakText}`);
          fetchUserData();
        }
      })
      .catch(() => {});
  }, [fetchUserData]);

  // Refetch when the Home tab gains focus so the dashboard self-heals
  // (e.g. recovering from an offline load) like the other screens do.
  useFocusEffect(
    useCallback(() => {
      fetchUserData();
    }, [fetchUserData])
  );

  const handleCourseGenerated = (generatedLesson: any) => {
    setLesson(generatedLesson);
    setShowLessonGenerator(false);
  };
  const handleLessonDisplayClose = () => {
    setLesson(null);
  };

  /**
 * Explicit user-initiated refresh ("refresh recommendations").
 *
 * This is the one place a POST is correct: the user asked for fresh cards, so
 * it bypasses the cooldown that throttles automatic generation. A 429 here is
 * a real budget refusal, so it is reported rather than swallowed -- silently
 * returning [] would look identical to "no recommendations yet".
 */
  const handleRefreshRecommendations = async () => {
    if (refreshingRecs.current) return;
    refreshingRecs.current = true;
    try {
      if (user?.id) {
        const data = await apiCall<Recommendation[]>(`/users/${user.id}/recommendations/`, {
          method: 'POST',
          body: JSON.stringify({}),
          noCache: true,
        });
        setRecommendations(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      if (isRateLimitError(err)) {
        Alert.alert('AI limit', err.message);
      } else {
        console.error('Error refreshing recommendations:', err);
      }
    } finally {
      refreshingRecs.current = false;
    }
  };

  const [isOpeningRecommendation, setIsOpeningRecommendation] = useState(false);

  /**
   * "View all" and per-row detail for Recent Activity and Badges.
   *
   * These used to navigate to the Activities tab and the Profile tab, which
   * meant the row you tapped was not the thing that happened: the dashboard
   * row either did nothing (activities with no `payload.route`) or dumped you
   * somewhere unrelated. In-place sheets keep the context and work for every
   * row, including ones with no route.
   */
  const [sheet, setSheet] = useState<'activities' | 'badges' | null>(null);
  const [detailActivity, setDetailActivity] = useState<Activity | null>(null);
  const [detailBadge, setDetailBadge] = useState<Badge | null>(null);

  /**
   * A For You card opens the course path, never a single activity directly.
   *
   * This used to fetch the path and deep-jump into the first unpassed node,
   * which dropped the student straight into a practice with no context and no
   * way to pick something else. The path screen already scrolls to and
   * highlights the first unpassed node, so it is a strictly better landing
   * spot: they choose the node and tap Start themselves.
   *
   * The route must be built from the card that was tapped. It previously fell
   * back to `enrolled[0]` when `course_id` was absent, and because the backend
   * serves enrolled courses newest-first that made every course-less card open
   * the student's most recent course -- so tapping card 3 of 4 landed on the
   * same place as card 1. `course_id` is null fairly often by design (the
   * recommendation prompt tells the model to return null rather than invent an
   * id it is not sure about), which is why this showed up as a bug at all.
   *
   * `href` is the server's own deep link for the card and is preferred when
   * present. If neither it nor `course_id` identifies a course there is nothing
   * specific to open, so say so instead of silently substituting a different
   * course the student did not tap.
   */
  const handleOpenRecommendation = useCallback(async (rec: Recommendation) => {
    if (isOpeningRecommendation) return;
    setIsOpeningRecommendation(true);
    try {
      if (rec.href) {
        router.push(rec.href as any);
        return;
      }

      if (rec.course_id) {
        router.push(`/(tabs)/course/path/${rec.course_id}` as any);
        return;
      }

      // The model could not tie this suggestion to a class, or the class has
      // since been deleted. The card is still worth showing, but there is no
      // course behind it to open, and picking an arbitrary enrolled course
      // would take the student somewhere they did not ask to go.
      Alert.alert(
        'Nothing specific to open yet',
        'This suggestion is not linked to a class. Enrol in a course and your next step will show up here.',
      );
    } catch {
      Alert.alert('Could not open that', 'Please try again in a moment.');
    } finally {
      setIsOpeningRecommendation(false);
    }
  }, [isOpeningRecommendation, router]);

  if (loading && !user) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
      </View>
    );
  }
  if (error && !user) {
    return (
      <View style={styles.loadingContainer}>
        <Ionicons name="cloud-offline-outline" size={48} color={COLORS.danger} />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} activeOpacity={0.85} onPress={handleRefresh}>
          <Ionicons name="refresh" size={16} color="#FFFFFF" />
          <Text style={styles.retryButtonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (showLessonGenerator) {
    return (
      <LessonGenerator
        onCourseGenerated={handleCourseGenerated}
        onCancel={() => setShowLessonGenerator(false)}
      />
    );
  }
  if (lesson) {
    return <LessonDisplay lesson={lesson} onClose={handleLessonDisplayClose} />;
  }

  const totalPoints = user?.total_points ?? 0;
  const level = user?.level || 1;

  return (
    <LinearGradient
      colors={['#FFFFFF', '#FFFFFF']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.mainWrapper}
    >
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      
      {/* FIXED HEADER */}
      <LinearGradient
        colors={[COLORS.purpleDeep, COLORS.purpleDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 20 }]}
      >
        <View style={styles.headerTop}>
          <View style={styles.logoContainer}>
            <Text style={styles.logoText}>SAGE</Text>
            <View style={styles.logoDot} />
          </View>
          <View style={styles.headerIcons}>
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.7}
              onPress={() => router.push('/(tabs)/activities')}
            >
              <Ionicons name="book" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.7}
              onPress={() => setShowNotifications(true)}
              accessibilityRole="button"
              accessibilityLabel={
                unreadCount > 0
                  ? `Notifications, ${unreadCount} unread`
                  : 'Notifications'
              }
            >
              <Ionicons name="notifications-outline" size={22} color={COLORS.textSecondary} />
              {unreadCount > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText} numberOfLines={1}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>

      {/* SCROLLABLE CONTENT */}
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.purpleVibrant}
            colors={[COLORS.purpleVibrant]}
          />
        }
      >
        {/* ERROR BANNER (inside scroll, shown when error occurs) */}
        {error ? (
          <View style={styles.refreshBanner}>
            <Ionicons name="cloud-offline-outline" size={14} color={COLORS.danger} />
            <Text style={styles.refreshBannerText}>{error}</Text>
          </View>
        ) : null}

        {/* CAROUSEL with Smooth Transitions */}
        <View style={styles.carouselWrapper}>
          <LinearGradient
            colors={['#4C1D95', '#6D28D9', '#7C3AED']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.carouselCard}
          >
            <Animated.ScrollView
              ref={scrollViewRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={handleMomentumScrollEnd}
              onScroll={onScroll}
              scrollEventThrottle={16}
              snapToInterval={CAROUSEL_PAGE_WIDTH}
              snapToOffsets={featurePages.map((_, i) => i * CAROUSEL_PAGE_WIDTH)}
              removeClippedSubviews={true}
              style={styles.carouselScroll}
              contentContainerStyle={{ paddingHorizontal: 0 }}
            >
              {featurePages.map((page) => (
                <View key={page.id} style={styles.carouselPageContainer}>
                  <View style={styles.featurePage}>
                    <View
                      style={[
                        styles.featureIconContainer,
                        { backgroundColor: `${page.color}30` },
                      ]}
                    >
                      <Ionicons name={page.icon as any} size={28} color={page.color} />
                    </View>
                    <View style={styles.featureContent}>
                      <Text style={styles.featureTitle}>{page.title}</Text>
                      <Text style={styles.featureDescription}>{page.description}</Text>
                      {page.route ? (
                        <TouchableOpacity
                          style={styles.featureButton}
                          onPress={() => router.push(page.route as any)}
                          activeOpacity={0.8}
                        >
                          <LinearGradient
                            colors={[page.color, page.color + 'CC']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={styles.featureButtonGradient}
                          >
                            <Text style={styles.featureButtonText}>Go</Text>
                            <Ionicons name="arrow-forward" size={14} color="white" />
                          </LinearGradient>
                        </TouchableOpacity>
                      ) : (
                        <View style={styles.streakBadgeInline}>
                          <Ionicons name="flash" size={12} color="#FBBF24" />
                          <Text style={styles.streakBadgeInlineText}>
                            {streakCount > 0 ? 'Active' : 'Start now'}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              ))}
            </Animated.ScrollView>

            {/* Animated Dot Indicator */}
            <View style={styles.dotContainer}>
              {featurePages.map((_, idx) => {
                return (
                  <DotIndicator
                    key={idx}
                    index={idx}
                    scrollX={scrollX}
                  />
                );
              })}
            </View>
          </LinearGradient>
        </View>

        {/* STATS CARDS */}
        <View style={styles.statsContainer}>
          <LinearGradient
            colors={[COLORS.purplePrimary, COLORS.purpleVibrant]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.statCard}
          >
            <View style={styles.statIconContainer}>
              <Ionicons name="trophy" size={20} color="white" />
            </View>
            <Text style={styles.statValue}>{totalPoints}</Text>
            <Text style={styles.statLabel}>Points</Text>
          </LinearGradient>

          <LinearGradient
            colors={[COLORS.purpleVibrant, COLORS.purpleLight]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.statCard}
          >
            <View style={styles.statIconContainer}>
              <Ionicons name="trending-up" size={20} color="white" />
            </View>
            <Text style={styles.statValue}>Lv {level}</Text>
            <Text style={styles.statLabel}>Level</Text>
          </LinearGradient>
        </View>

        {/* For You */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleContainer}>
              <LinearGradient
                colors={[COLORS.purpleVibrant, COLORS.purpleLight]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.sectionIconBox}
              >
                <Ionicons name="sparkles" size={18} color="white" />
              </LinearGradient>
              <Text style={styles.sectionTitle}>For You</Text>
            </View>
            <TouchableOpacity onPress={handleRefreshRecommendations}>
              <Text style={styles.viewAllText}>Refresh</Text>
            </TouchableOpacity>
          </View>

          {recommendations.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
              style={styles.carouselBleed}
              removeClippedSubviews={true}
            >
              {recommendations.slice(0, 4).map((rec, index) => {
                const gradients: [string, string][] = [
                  ['#EDE9FE', '#DDD6FE'],
                  ['#FCE7F3', '#FBCFE8'],
                  ['#D1FAE5', '#A7F3D0'],
                  ['#FEF3C7', '#FDE68A'],
                ];
                return (
                  <TouchableOpacity
                    key={rec.id}
                    activeOpacity={0.7}
                    onPress={() => handleOpenRecommendation(rec)}
                    accessibilityRole="button"
                    accessibilityLabel={`${rec.title}. View learning path`}
                  >
                    <LinearGradient
                      colors={gradients[index % gradients.length]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.recommendationCard}
                    >
                      <Text style={styles.recommendationTitle} numberOfLines={2}>
                        {rec.title}
                      </Text>
                      <Text style={styles.recommendationDesc} numberOfLines={3}>
                        {rec.description}
                      </Text>
                      <Text style={styles.recommendationCTA}>View path →</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : (
            <View style={styles.emptyStateCard}>
              <View style={styles.emptyStateIconContainer}>
                <Ionicons name="bulb-outline" size={48} color={COLORS.purpleVibrant} />
              </View>
              <Text style={styles.emptyStateTitle}>No recommendations yet</Text>
              <Text style={styles.emptyStateText}>
                Complete more lessons to get personalized suggestions
              </Text>
            </View>
          )}
        </View>

        {/* Recent Activity */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleContainer}>
              <View
                style={[
                  styles.sectionIconBox,
                  { backgroundColor: 'rgba(156, 163, 175, 0.2)' },
                ]}
              >
                <Ionicons name="time" size={18} color={COLORS.textMuted} />
              </View>
              <Text style={styles.sectionTitle}>Recent Activity</Text>
            </View>
            <TouchableOpacity
              onPress={() => setSheet('activities')}
              accessibilityRole="button"
              accessibilityLabel="View all recent activity"
            >
              <Text style={styles.viewAllText}>View all</Text>
            </TouchableOpacity>
          </View>

          {activities.length > 0 ? (
            <View style={styles.activityList}>
              {activities.slice(0, 4).map((activity) => {
                const meta = ACTIVITY_META[activity.kind || ''] || ACTIVITY_META.other;
                return (
                  <TouchableOpacity
                    key={activity.id}
                    style={styles.activityItem}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`${activity.title}. View details`}
                    onPress={() => setDetailActivity(activity)}
                  >
                    <View style={[styles.activityIconBox, { backgroundColor: `${meta.color}26` }]}>
                      <Ionicons name={meta.icon} size={20} color={meta.color} />
                    </View>
                    <View style={styles.activityContent}>
                      <Text style={styles.activityTitle} numberOfLines={1}>
                        {activity.title}
                      </Text>
                      <Text style={styles.activityDesc} numberOfLines={1}>
                        {activity.description}
                      </Text>
                    </View>
                    <View style={styles.activityRight}>
                      {activity.xp_earned ? (
                        <View style={styles.xpChip}>
                          <Text style={styles.xpChipText}>+{activity.xp_earned} XP</Text>
                        </View>
                      ) : null}
                      {activity.created_at ? (
                        <Text style={styles.activityTime}>{relativeTime(activity.created_at)}</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <View style={styles.emptyStateCard}>
              <View style={styles.emptyStateIconContainer}>
                <Ionicons name="analytics-outline" size={48} color={COLORS.textMuted} />
              </View>
              <Text style={styles.emptyStateTitle}>No activity yet</Text>
              <Text style={styles.emptyStateText}>Your recent activities will appear here</Text>
            </View>
          )}
        </View>

        {/* Badges */}
        {badges.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleContainer}>
                <LinearGradient
                  colors={[COLORS.warning, '#FBBF24']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.sectionIconBox}
                >
                  <Ionicons name="ribbon" size={18} color="white" />
                </LinearGradient>
                <Text style={styles.sectionTitle}>Badges</Text>
              </View>
              <TouchableOpacity
                onPress={() => setSheet('badges')}
                accessibilityRole="button"
                accessibilityLabel="View all badges"
              >
                <Text style={styles.viewAllText}>View all</Text>
              </TouchableOpacity>
            </View>
<ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.badgeScroll}
              style={styles.carouselBleed}
              removeClippedSubviews={true}
            >
              {badges.slice(0, 6).map((badge) => (
                <TouchableOpacity
                  key={badge.id}
                  style={styles.badgeItem}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={`Badge ${badge.name}. View how to earn it.`}
                  onPress={() => setDetailBadge(badge)}
                >
                  <LinearGradient
                    colors={[COLORS.purpleDark, COLORS.purpleVibrant]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.badgeCircle}
                  >
                    <Text style={styles.badgeEmoji}>{badge.icon || badge.icon_url || '🏆'}</Text>
                  </LinearGradient>
                  <Text style={styles.badgeName} numberOfLines={1}>
                    {badge.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>

      {/* Notification centre — in-tree overlay over the whole dashboard. */}
      <NotificationSheet
        visible={showNotifications}
        onClose={() => setShowNotifications(false)}
        onOpenHref={(href) => router.push(href as any)}
        onUnreadChange={setUnreadCount}
        activities={activities}
        badges={badges}
        recommendations={recommendations}
      />

      {/* View-all + detail sheets. In-tree overlays, never <Modal>, because
          Android drops a Modal stacked on another. */}
      <BottomSheet
        visible={sheet === 'activities'}
        onClose={() => setSheet(null)}
        title="Recent Activity"
        subtitle={`${activities.length} ${activities.length === 1 ? 'entry' : 'entries'}`}
      >
        {activities.length === 0 ? (
          <View style={styles.sheetEmpty}>
            <Ionicons name="analytics-outline" size={36} color={COLORS.textMuted} />
            <Text style={styles.sheetEmptyText}>No activity yet.</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetList}>
            {activities.map((activity) => {
              const meta = ACTIVITY_META[activity.kind || ''] || ACTIVITY_META.other;
              return (
                <TouchableOpacity
                  key={activity.id}
                  style={styles.sheetRow}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={`${activity.title}. View details`}
                  onPress={() => {
                    setSheet(null);
                    setDetailActivity(activity);
                  }}
                >
                  <View style={[styles.activityIconBox, { backgroundColor: `${meta.color}26` }]}>
                    <Ionicons name={meta.icon} size={20} color={meta.color} />
                  </View>
                  <View style={styles.activityContent}>
                    <Text style={styles.activityTitle} numberOfLines={1}>
                      {activity.title}
                    </Text>
                    <Text style={styles.activityDesc} numberOfLines={1}>
                      {activity.description}
                    </Text>
                  </View>
                  <View style={styles.activityRight}>
                    {activity.xp_earned ? (
                      <View style={styles.xpChip}>
                        <Text style={styles.xpChipText}>+{activity.xp_earned} XP</Text>
                      </View>
                    ) : null}
                    {activity.created_at ? (
                      <Text style={styles.activityTime}>{relativeTime(activity.created_at)}</Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </BottomSheet>

      <BottomSheet
        visible={sheet === 'badges'}
        onClose={() => setSheet(null)}
        title="Badges"
        subtitle={`${badges.length} earned`}
      >
        {badges.length === 0 ? (
          <View style={styles.sheetEmpty}>
            <Ionicons name="ribbon-outline" size={36} color={COLORS.textMuted} />
            <Text style={styles.sheetEmptyText}>No badges yet.</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetList}>
            {badges.map((badge) => (
              <TouchableOpacity
                key={badge.id}
                style={styles.sheetRow}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={`Badge ${badge.name}. View how to earn it.`}
                onPress={() => {
                  setSheet(null);
                  setDetailBadge(badge);
                }}
              >
                <View style={styles.sheetBadgeCircle}>
                  <Text style={styles.badgeEmoji}>{badge.icon || badge.icon_url || '🏆'}</Text>
                </View>
                <View style={styles.activityContent}>
                  <Text style={styles.activityTitle} numberOfLines={1}>
                    {badge.name}
                  </Text>
                  <Text style={styles.activityDesc} numberOfLines={2}>
                    {badge.description || 'Earned for reaching a milestone.'}
                  </Text>
                </View>
                {badge.earned_at ? (
                  <Text style={styles.activityTime}>{relativeTime(badge.earned_at)}</Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </BottomSheet>

      <BottomSheet
        visible={detailActivity != null}
        onClose={() => setDetailActivity(null)}
        title={detailActivity?.title || 'Activity'}
        subtitle={
          detailActivity?.created_at ? relativeTime(detailActivity.created_at) : undefined
        }
        maxHeight="60%"
      >
        <View style={styles.sheetDetail}>
          <Text style={styles.sheetDetailText}>
            {detailActivity?.description || 'No further detail was recorded.'}
          </Text>
          <View style={styles.sheetDetailMeta}>
            {detailActivity?.course_name ? (
              <Text style={styles.sheetDetailMetaText}>{detailActivity.course_name}</Text>
            ) : null}
            {detailActivity?.xp_earned ? (
              <Text style={[styles.sheetDetailMetaText, { color: COLORS.purpleVibrant }]}>
                +{detailActivity.xp_earned} XP
              </Text>
            ) : null}
          </View>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={detailBadge != null}
        onClose={() => setDetailBadge(null)}
        title={detailBadge?.name || 'Badge'}
        subtitle={
          detailBadge?.earned_at ? `Earned ${relativeTime(detailBadge.earned_at)}` : undefined
        }
        maxHeight="60%"
      >
        <View style={styles.sheetDetail}>
          <Text style={styles.sheetDetailText}>
            {detailBadge?.description || 'Earned for reaching a milestone.'}
          </Text>
          {detailBadge?.course_name ? (
            <Text style={[styles.sheetDetailMetaText, { marginTop: 10 }]}>
              {detailBadge.course_name}
            </Text>
          ) : null}
        </View>
      </BottomSheet>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  mainWrapper: { flex: 1 },

  // --- Bottom sheets ---
  sheetList: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sheetBadgeCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.purpleGhost,
  },
  sheetEmpty: { paddingVertical: 36, alignItems: 'center', gap: 10 },
  sheetEmptyText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textMuted },
  sheetDetail: { paddingHorizontal: 20, paddingBottom: 8 },
  sheetDetailText: {
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary,
    lineHeight: 21,
  },
  sheetDetailMeta: { flexDirection: 'row', gap: 12, marginTop: 12 },
  sheetDetailMetaText: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted },

  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    marginTop: 16,
    color: COLORS.danger,
    fontSize: 15,
    textAlign: 'center',
    fontFamily: FONTS.medium,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
    backgroundColor: COLORS.purpleVibrant,
    borderRadius: 24,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: FONTS.semiBold,
  },
  refreshBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 10,
    backgroundColor: '#FEE2E2',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  refreshBannerText: {
    flex: 1,
    color: COLORS.danger,
    fontSize: 12,
    fontFamily: FONTS.medium,
  },
  container: { flex: 1 },

  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 32,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 0,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoText: {
    color: 'white',
    fontSize: 32,
    fontFamily: FONTS.black,
    fontWeight: '900',
    letterSpacing: -2,
  },
  logoDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.success,
    marginLeft: 4,
    marginTop: 8,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bellBadge: {
    position: 'absolute',
    top: 3,
    right: 3,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.purpleDark,
  },
  bellBadgeText: {
    color: 'white',
    fontSize: 9,
    lineHeight: 12,
    fontFamily: 'Montserrat-ExtraBold',
    fontWeight: '900',
  },

  carouselWrapper: {
    paddingHorizontal: 24,
    marginBottom: 16,
    marginTop: 12,
  },
  carouselCard: {
    borderRadius: 16,
    padding: 12,
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
    overflow: 'hidden',
  },
  carouselScroll: {
    height: 110,
  },
  carouselPageContainer: {
    width: CAROUSEL_PAGE_WIDTH,
    justifyContent: 'center',
  },
  featurePage: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 12,
    flex: 1,
  },
  featureIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureContent: {
    flex: 1,
    flexShrink: 1,
  },
  featureTitle: {
    color: 'white',
    fontSize: 15,
    fontFamily: FONTS.bold,
    marginBottom: 2,
  },
  featureDescription: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontFamily: FONTS.regular,
    lineHeight: 16,
    marginBottom: 4,
    flexShrink: 1,
  },
  featureButton: {
    alignSelf: 'flex-start',
  },
  featureButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
  },
  featureButtonText: {
    color: 'white',
    fontSize: 12,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
  },
  streakBadgeInline: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 4,
    alignSelf: 'flex-start',
  },
  streakBadgeInlineText: {
    color: '#FBBF24',
    fontSize: 11,
    fontFamily: FONTS.bold,
    letterSpacing: 0.3,
  },
  dotContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 6,
    gap: 6,
  },
  dot: {
    height: 7,
    borderRadius: 3.5,
  },

  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    marginBottom: 24,
    gap: 10,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    shadowColor: COLORS.purpleDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  statIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  statValue: {
    color: 'white',
    fontSize: 22,
    fontFamily: FONTS.black,
    marginBottom: 2,
    letterSpacing: -0.5,
  },
  statLabel: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 11,
    fontFamily: FONTS.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  section: {
    paddingHorizontal: 24,
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionIconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontFamily: FONTS.extraBold,
    fontWeight: '900',
    letterSpacing: 1,
  },
  viewAllText: {
    color: COLORS.purpleDeep,
    fontSize: 14,
    fontFamily: FONTS.extraBold,
    fontWeight: '500',
  },
  scrollContent: {
    paddingLeft: 24,
    paddingRight: 24,
  },
  carouselBleed: {
    marginHorizontal: -24,
  },
  emptyStateCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 40,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  emptyStateIconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.bgSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyStateTitle: {
    color: COLORS.purpleDark,
    fontSize: 16,
    fontFamily: FONTS.bold,
    marginBottom: 6,
  },
  emptyStateText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontFamily: FONTS.regular,
    textAlign: 'center',
    lineHeight: 20,
  },

  recommendationCard: {
    width: 240,
    borderRadius: 20,
    padding: 20,
    marginRight: 12,
  },
  recommendationTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontFamily: FONTS.bold,
    marginBottom: 8,
  },
  recommendationDesc: {
    color: COLORS.textMuted,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: FONTS.regular,
    marginBottom: 14,
  },
  recommendationCTA: {
    color: COLORS.purpleDeep,
    fontSize: 13,
    fontFamily: FONTS.semiBold,
    fontWeight: '600',
  },

  activityList: {},
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 14,
  },
  activityIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityContent: {
    flex: 1,
  },
  activityRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  xpChip: {
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  xpChipText: {
    color: COLORS.purpleVibrant,
    fontSize: 11,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
  activityTime: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontFamily: FONTS.medium,
  },
  activityTitle: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontFamily: FONTS.semiBold,
    marginBottom: 3,
  },
  activityDesc: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontFamily: FONTS.regular,
  },

  badgeScroll: {
    gap: 16,
    paddingLeft: 24,
    paddingRight: 24,
  },
  badgeItem: {
    alignItems: 'center',
    width: 76,
    marginRight: 12,
  },
  badgeCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  badgeEmoji: {
    fontSize: 32,
  },
  badgeName: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontFamily: FONTS.semiBold,
    textAlign: 'center',
  },

});
