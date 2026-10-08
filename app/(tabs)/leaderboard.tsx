import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { useFocusEffect, useRouter } from "expo-router";
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { MotionPressable } from "../../src/components/MotionPressable";
import { useAuth } from "../../src/context/AuthContext";
import { Screen } from "../../src/components/Screen";
import { useSavedVenueSlugs } from "../../src/hooks/useSavedVenueSlugs";
import { useVenues } from "../../src/hooks/useVenues";
import { getCrowdColor, getCrowdEmoji, getCrowdHint, getCrowdLabel, getCrowdScore, getCrowdTrendHint, getCrowdTrendLabel } from "../../src/lib/crowd";
import { getDistanceMeters } from "../../src/lib/geo";
import { playSelectionHaptic } from "../../src/lib/haptics";
import { getNowPlayingText } from "../../src/lib/nowPlaying";
import { formatVenueDistance, getVenueOpenStateLabel, getVenueOpenStatePriority, getVenueSoundLabels, matchesVenueActivity, matchesVenueSound, type VenueActivityFilter, venueSoundLabels } from "../../src/lib/venueDiscovery";
import { featureVenueOnTrending, removeVenueFromTrending } from "../../src/services/adminVenueService";
import { colors } from "../../src/theme/colors";
import { type Venue, type VenueKind, type VenueSoundTag } from "../../src/types/venue";

type LeaderboardMode = "best" | "live" | "trending";

type LeaderboardFilter = "all" | "nearby" | "saved" | VenueKind;

type UserLocation = {
  latitude: number;
  longitude: number;
};

type RankedVenue = {
  distanceMeters?: number;
  venue: Venue;
};

const FILTERS: { label: string; value: LeaderboardFilter }[] = [
  { label: "All", value: "all" },
  { label: "Near me", value: "nearby" },
  { label: "My spots", value: "saved" },
  { label: "Bars", value: "bar" },
  { label: "Clubs", value: "club" }
];

const MODES: { label: string; value: LeaderboardMode }[] = [
  { label: "Live", value: "live" },
  { label: "Trending", value: "trending" },
  { label: "Best rated", value: "best" }
];

const ACTIVITY_FILTERS: { label: string; value: VenueActivityFilter }[] = [
  { label: "Any energy", value: "any" },
  { label: "Calm", value: "calm" },
  { label: "Lively", value: "lively" }
];

const SOUND_FILTERS: { label: string; value: VenueSoundTag | "any" }[] = [
  { label: "Any sound", value: "any" },
  ...(["electronic", "dance-pop", "rock", "live-music", "karaoke", "jazz", "mixed"] as VenueSoundTag[]).map((value) => ({ label: venueSoundLabels[value], value }))
];

const NEARBY_RADIUS_METERS = 5000;
const topCardEntering = [0, 1, 2].map((index) => FadeInDown.delay(index * 45).duration(200));

export default function LeaderboardScreen() {
  const router = useRouter();
  const { isAdmin, refreshAdminStatus } = useAuth();
  const { error, isLoading, refresh, source, venues, warning } = useVenues();
  const [activityFilter, setActivityFilter] = useState<VenueActivityFilter>("any");
  const [activeFilter, setActiveFilter] = useState<LeaderboardFilter>("all");
  const [activeMode, setActiveMode] = useState<LeaderboardMode>("live");
  const [adminBusyVenueId, setAdminBusyVenueId] = useState<string | null>(null);
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const [adminSearch, setAdminSearch] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [soundFilter, setSoundFilter] = useState<VenueSoundTag | "any">("any");
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const resultsOpacity = useSharedValue(1);
  const resultsStyle = useAnimatedStyle(() => ({ opacity: resultsOpacity.value }));
  const { savedVenueSlugs } = useSavedVenueSlugs();
  const rankedVenues = getRankedVenues(activeMode, activeFilter, activityFilter, soundFilter, venues, userLocation, savedVenueSlugs);
  const availableSoundTags = new Set<VenueSoundTag>(venues.flatMap((venue) => venue.soundTags).filter((tag) => tag !== "unknown"));
  const availableSoundFilters = SOUND_FILTERS.filter((filter) => filter.value === "any" || filter.value === soundFilter || availableSoundTags.has(filter.value));
  const nextTrendingRank = Math.min(999, Math.max(0, ...venues.map((venue) => venue.trendingRank ?? 0)) + 1);
  const normalizedAdminSearch = adminSearch.trim().toLocaleLowerCase();
  const adminVenueResults = venues
    .filter((venue) => venue.isRemote && (!normalizedAdminSearch || `${venue.name} ${venue.neighborhood}`.toLocaleLowerCase().includes(normalizedAdminSearch)))
    .sort((left, right) => Number(right.trendingRank !== undefined) - Number(left.trendingRank !== undefined) || left.name.localeCompare(right.name))
    .slice(0, 6);

  useFocusEffect(
    useCallback(() => {
      void refreshAdminStatus();
    }, [refreshAdminStatus])
  );

  useEffect(() => {
    resultsOpacity.value = 0.35;
    resultsOpacity.value = withTiming(1, { duration: 180 });
  }, [activeFilter, activeMode, resultsOpacity, userLocation]);

  async function handleFilterPress(filter: LeaderboardFilter) {
    if (filter !== activeFilter || (filter === "nearby" && !userLocation)) {
      playSelectionHaptic();
    }

    setActiveFilter(filter);

    if (filter !== "nearby" || userLocation) {
      return;
    }

    setLocationMessage(null);
    setIsLocating(true);

    try {
      const permission = await Location.requestForegroundPermissionsAsync();

      if (permission.status !== Location.PermissionStatus.GRANTED) {
        setLocationMessage("Location permission is needed to rank nearby venues. No crowd signal was sent.");
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setUserLocation({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude
      });
      setLocationMessage("Nearby ranking uses this device location only for sorting. No crowd signal was sent.");
    } catch (locationError) {
      setLocationMessage(locationError instanceof Error ? locationError.message : "Could not get current location.");
    } finally {
      setIsLocating(false);
    }
  }

  function handleModePress(mode: LeaderboardMode) {
    if (mode === activeMode) {
      return;
    }

    playSelectionHaptic();
    setActiveMode(mode);
  }

  function handleVenuePress(venue: Venue) {
    playSelectionHaptic();
    router.push(getVenueDetailHref(venue.slug));
  }

  async function handleTrendingPlacement(venue: Venue) {
    setAdminBusyVenueId(venue.id);
    setAdminMessage(null);

    try {
      const result = venue.trendingRank !== undefined
        ? await removeVenueFromTrending(venue.id)
        : await featureVenueOnTrending(venue.id, nextTrendingRank);
      setAdminMessage(result.message);

      if (result.ok) {
        await refresh({ force: true });
      }
    } catch (adminError) {
      setAdminMessage(adminError instanceof Error ? adminError.message : "Trending could not be updated.");
    } finally {
      setAdminBusyVenueId(null);
    }
  }

  return (
    <Screen>
      <FlatList
        contentContainerStyle={styles.content}
        data={rankedVenues}
        initialNumToRender={6}
        ItemSeparatorComponent={LeaderboardItemSeparator}
        keyboardShouldPersistTaps="handled"
        keyExtractor={({ venue }) => venue.slug}
        ListEmptyComponent={(
          <Animated.View style={resultsStyle}>
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{getEmptyTitle(activeMode, activeFilter)}</Text>
              <Text style={styles.emptyText}>{getEmptyText(activeMode, activeFilter, userLocation)}</Text>
            </View>
          </Animated.View>
        )}
        ListHeaderComponent={(
          <>
            <Text style={styles.kicker}>Live ranking</Text>
            <Text accessibilityRole="header" style={styles.title}>Where Helsinki is moving tonight.</Text>
            <Text style={styles.subtitle}>{getLeaderboardSubtitle(source, isLoading, venues.length)}</Text>
            {error && <Text style={styles.errorText}>{error}</Text>}
            {warning && <Text accessibilityLiveRegion="polite" style={styles.warningText}>{warning}</Text>}

            <View accessibilityRole="tablist" style={styles.modeSwitch}>
              {MODES.map((mode) => {
                const isActive = activeMode === mode.value;

                return (
                  <MotionPressable accessibilityRole="tab" accessibilityState={{ selected: isActive }} containerStyle={styles.modeChipContainer} key={mode.value} onPress={() => handleModePress(mode.value)} style={[styles.modeChip, isActive && styles.modeChipActive]}>
                    <Text style={[styles.modeText, isActive && styles.modeTextActive]}>{mode.label}</Text>
                  </MotionPressable>
                );
              })}
            </View>
            <Text style={styles.modeHint}>{getModeHint(activeMode)}</Text>

            {isAdmin && activeMode === "trending" && (
              <View style={styles.adminCard}>
                <Text style={styles.adminTitle}>Manage Trending</Text>
                <Text style={styles.adminText}>Visible only to authorized Riento accounts. Featured venues stay here for 12 hours unless removed.</Text>
                <TextInput
                  accessibilityLabel="Search venues to manage on Trending"
                  autoCapitalize="none"
                  onChangeText={setAdminSearch}
                  placeholder="Search venue or area"
                  placeholderTextColor={colors.muted}
                  style={styles.adminSearch}
                  value={adminSearch}
                />
                <View style={styles.adminResults}>
                  {adminVenueResults.map((venue) => {
                    const isBusy = adminBusyVenueId === venue.id;
                    const isFeatured = venue.trendingRank !== undefined;

                    return (
                      <View key={venue.id} style={styles.adminRow}>
                        <View style={styles.adminRowCopy}>
                          <Text style={styles.adminVenueName}>{venue.name}</Text>
                          <Text style={styles.adminVenueMeta}>{venue.neighborhood}{isFeatured ? " / On Trending" : ""}</Text>
                        </View>
                        <Pressable
                          accessibilityLabel={`${isFeatured ? "Remove featured placement for" : "Add"} ${venue.name} ${isFeatured ? "" : "to Trending"}`}
                          accessibilityRole="button"
                          disabled={adminBusyVenueId !== null}
                          onPress={() => handleTrendingPlacement(venue)}
                          style={[styles.adminAction, isFeatured && styles.adminActionRemove, adminBusyVenueId !== null && styles.buttonDisabled]}
                        >
                          <Text style={styles.adminActionText}>{isBusy ? "Saving..." : isFeatured ? "Unfeature" : "Feature"}</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
                {source !== "supabase" && <Text style={styles.adminMessage}>Admin controls need live Supabase venue data.</Text>}
                {adminMessage && <Text accessibilityLiveRegion="polite" style={styles.adminMessage}>{adminMessage}</Text>}
              </View>
            )}

            <Text style={styles.filterLabel}>Energy</Text>
            <ScrollView accessibilityLabel="Activity filters" horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroller}>
              <View style={styles.horizontalFilters}>
                {ACTIVITY_FILTERS.map((filter) => {
                  const isActive = activityFilter === filter.value;
                  return (
                    <MotionPressable accessibilityRole="button" accessibilityState={{ selected: isActive }} key={filter.value} onPress={() => setActivityFilter(filter.value)} style={[styles.filterChip, isActive && styles.filterChipActive]}>
                      <Text style={[styles.filterText, isActive && styles.filterTextActive]}>{filter.label}</Text>
                    </MotionPressable>
                  );
                })}
              </View>
            </ScrollView>

            <Text style={styles.filterLabel}>Sound</Text>
            <ScrollView accessibilityLabel="Music filters" horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroller}>
              <View style={styles.horizontalFilters}>
                {availableSoundFilters.map((filter) => {
                  const isActive = soundFilter === filter.value;
                  return (
                    <MotionPressable accessibilityRole="button" accessibilityState={{ selected: isActive }} key={filter.value} onPress={() => setSoundFilter(filter.value)} style={[styles.filterChip, isActive && styles.filterChipActive]}>
                      <Text style={[styles.filterText, isActive && styles.filterTextActive]}>{filter.label}</Text>
                    </MotionPressable>
                  );
                })}
              </View>
            </ScrollView>

            <View accessibilityLabel="Venue filters" style={styles.filters}>
              {FILTERS.map((filter) => {
                const isActive = activeFilter === filter.value;

                return (
                  <MotionPressable accessibilityRole="button" accessibilityState={{ selected: isActive }} disabled={isLocating && filter.value === "nearby"} key={filter.value} onPress={() => handleFilterPress(filter.value)} style={[styles.filterChip, isActive && styles.filterChipActive]}>
                    <Text style={[styles.filterText, isActive && styles.filterTextActive]}>{isLocating && filter.value === "nearby" ? "Locating..." : filter.label}</Text>
                  </MotionPressable>
                );
              })}
            </View>

            {locationMessage && <Text accessibilityLiveRegion="polite" style={styles.locationMessage}>{locationMessage}</Text>}
            <Text accessibilityLiveRegion="polite" style={styles.countText}>{getCountText(activeMode, activeFilter, rankedVenues.length, userLocation)}</Text>
          </>
        )}
        ListHeaderComponentStyle={styles.listHeader}
        maxToRenderPerBatch={6}
        removeClippedSubviews={false}
        renderItem={({ item: { distanceMeters, venue }, index }) => {
          const crowdColor = getCrowdColor(venue.crowdLevel, venue.hasLiveCrowdSignal);
          const accentColor = getCardAccentColor(activeMode, venue);
          const card = (
            <Pressable accessibilityHint="Opens venue details" accessibilityLabel={getVenueAccessibilityLabel(index, venue, distanceMeters)} accessibilityRole="button" onPress={() => handleVenuePress(venue)} style={[styles.card, { borderColor: `${accentColor}55` }]}>
              <View style={[styles.rankBadge, { backgroundColor: `${accentColor}20` }]}>
                <Text style={[styles.rankText, { color: accentColor }]}>{index + 1}</Text>
              </View>
              <View style={styles.cardMain}>
                <View style={styles.cardHeader}>
                  <Text style={styles.venueName}>{venue.name}</Text>
                  <View style={[styles.levelPill, { borderColor: crowdColor }]}>
                    <View style={[styles.levelDot, { backgroundColor: crowdColor }]} />
                    <Text style={styles.levelText}>{getCrowdEmoji(venue.crowdLevel, venue.hasLiveCrowdSignal)} {getCrowdLabel(venue.crowdLevel, venue.hasLiveCrowdSignal)}</Text>
                  </View>
                </View>
                <Text style={styles.meta}>{venue.neighborhood} / {venue.kind}</Text>
                <Text style={styles.discoveryMeta}>{getVenueOpenStateLabel(venue.openingHours)} / {venue.vibe}</Text>
                <Text style={styles.soundText}>Usually: {getVenueSoundLabels(venue.soundTags).join(", ")}</Text>
                {activeMode === "trending" && <Text style={styles.trendingHeadline}>{venue.trendingHeadline ?? getTrendingFallbackText(venue)}</Text>}
                {venue.averageRating && <Text style={styles.ratingText}>{formatVenueRating(venue)}</Text>}
                <Text style={styles.nowPlayingText}>Now playing: {getNowPlayingText(venue.nowPlaying)}</Text>
                {distanceMeters !== undefined && <Text style={styles.distanceText}>{formatDistance(distanceMeters)} away</Text>}
                {venue.hasLiveCrowdSignal && (
                  <View style={styles.signalBarTrack}>
                    <View style={[styles.signalBar, { backgroundColor: crowdColor, width: `${Math.round(getCrowdScore(venue) * 100)}%` }]} />
                  </View>
                )}
                <Text style={styles.detail}>{getDetailText(source, venue)}</Text>
                {venue.crowdTrend && <Text style={styles.trendText}>{getCrowdTrendLabel(venue.crowdTrend)} / {getCrowdTrendHint(venue.crowdTrend)}</Text>}
                <Text style={styles.tapHint}>Tap for venue details</Text>
              </View>
            </Pressable>
          );

          return (
            <Animated.View style={resultsStyle}>
              {index < topCardEntering.length ? (
                <Animated.View entering={topCardEntering[index]} key={`${activeMode}-${activeFilter}-${venue.slug}`}>
                  {card}
                </Animated.View>
              ) : card}
            </Animated.View>
          );
        }}
        showsVerticalScrollIndicator={false}
        windowSize={9}
      />
    </Screen>
  );
}

function LeaderboardItemSeparator() {
  return <View style={styles.listSeparator} />;
}

function getLeaderboardSubtitle(source: "local" | "supabase", isLoading: boolean, venueCount: number) {
  if (isLoading) {
    return "Loading Helsinki venue signals...";
  }

  if (source === "supabase") {
    return `Showing ${venueCount} Helsinki venues with broad activity levels. Exact counts stay hidden.`;
  }

  return `Showing ${venueCount} provisional local venues without live crowd or music data.`;
}

function getModeHint(activeMode: LeaderboardMode) {
  switch (activeMode) {
    case "best":
      return "Best rated uses community ratings, not crowd size. It will stay empty until people rate venues.";
    case "trending":
      return "Trending prioritizes admin-curated picks first, then venues that are rising tonight.";
    case "live":
      return "Live ranks current venue signals without showing exact counts.";
  }
}

function getDetailText(source: "local" | "supabase", venue: Venue) {
  if (source === "supabase" && venue.hasLiveCrowdSignal) {
    return `${getCrowdHint(venue.crowdLevel)} from current venue activity. No exact counts shown.`;
  }

  return source === "supabase" ? "No current device signal. Exact counts stay hidden." : "Live signal unavailable while using provisional local venue data.";
}

function getRankedVenues(activeMode: LeaderboardMode, activeFilter: LeaderboardFilter, activityFilter: VenueActivityFilter, soundFilter: VenueSoundTag | "any", venues: Venue[], userLocation: UserLocation | null, savedVenueSlugs: Set<string>): RankedVenue[] {
  const now = new Date();
  const filteredVenues = getFilteredVenues(activeFilter, venues, userLocation, savedVenueSlugs);
  const discoveryMatches = filteredVenues.filter(({ venue }) => matchesVenueActivity(venue, activityFilter) && matchesVenueSound(venue, soundFilter));
  const visibleVenues = activeMode === "best"
    ? discoveryMatches.filter(({ venue }) => venue.averageRating && venue.ratingCount)
    : activeMode === "live"
      ? discoveryMatches.filter(({ venue }) => venue.hasLiveCrowdSignal)
      : discoveryMatches.filter(({ venue }) => venue.hasLiveCrowdSignal || venue.trendingRank !== undefined);

  return visibleVenues.sort((a, b) => compareRankedVenues(activeMode, a, b, now));
}

function getFilteredVenues(activeFilter: LeaderboardFilter, venues: Venue[], userLocation: UserLocation | null, savedVenueSlugs: Set<string>): RankedVenue[] {
  if (activeFilter === "nearby") {
    if (!userLocation) {
      return [];
    }

    return venues
      .map((venue) => ({
        distanceMeters: getDistanceMeters(userLocation, venue),
        venue
      }))
      .filter(({ distanceMeters }) => distanceMeters <= NEARBY_RADIUS_METERS);
  }

  if (activeFilter === "saved") {
    return venues.filter((venue) => savedVenueSlugs.has(venue.slug)).map((venue) => ({ venue }));
  }

  const filteredVenues = activeFilter === "all" ? [...venues] : venues.filter((venue) => venue.kind === activeFilter);

  return filteredVenues.map((venue) => ({ venue }));
}

function compareRankedVenues(activeMode: LeaderboardMode, left: RankedVenue, right: RankedVenue, now: Date) {
  const openStateDifference = getVenueOpenStatePriority(left.venue.openingHours, now) - getVenueOpenStatePriority(right.venue.openingHours, now);

  if (activeMode === "best") {
    return (
      (right.venue.averageRating ?? 0) - (left.venue.averageRating ?? 0) ||
      (right.venue.ratingCount ?? 0) - (left.venue.ratingCount ?? 0) ||
      openStateDifference ||
      getCrowdScore(right.venue) - getCrowdScore(left.venue) ||
      compareDistance(left, right)
    );
  }

  if (activeMode === "trending") {
    return getTrendingRank(left.venue) - getTrendingRank(right.venue) || getTrendWeight(right.venue) - getTrendWeight(left.venue) || getCrowdScore(right.venue) - getCrowdScore(left.venue) || openStateDifference || compareDistance(left, right);
  }

  return getCrowdScore(right.venue) - getCrowdScore(left.venue) || openStateDifference || compareDistance(left, right);
}

function compareDistance(left: RankedVenue, right: RankedVenue) {
  return (left.distanceMeters ?? Number.POSITIVE_INFINITY) - (right.distanceMeters ?? Number.POSITIVE_INFINITY);
}

function getTrendingRank(venue: Venue) {
  return venue.trendingRank ?? Number.POSITIVE_INFINITY;
}

function getTrendWeight(venue: Venue) {
  if (venue.trendingRank) {
    return 10;
  }

  switch (venue.crowdTrend) {
    case "rising":
      return 2;
    case "steady":
      return 1;
    case "cooling":
    default:
      return 0;
  }
}

function getCountText(activeMode: LeaderboardMode, activeFilter: LeaderboardFilter, venueCount: number, userLocation: UserLocation | null) {
  if (activeFilter === "nearby") {
    return userLocation ? `${venueCount} venues within ${Math.round(NEARBY_RADIUS_METERS / 1000)} km` : "Location needed for nearby ranking";
  }

  if (activeFilter === "saved") {
    return `${venueCount} saved ${activeMode === "best" ? "rated " : ""}venues ranked`;
  }

  const venueNoun = activeFilter === "all" ? "venues" : activeFilter === "bar" ? "bars" : "clubs";
  const modePrefix = activeMode === "best" ? "rated " : activeMode === "trending" ? "trending " : "";

  return `${venueCount} ${modePrefix}${venueNoun} ranked`;
}

function getEmptyTitle(activeMode: LeaderboardMode, activeFilter: LeaderboardFilter) {
  if (activeFilter === "nearby") {
    return "No nearby venues yet";
  }

  if (activeFilter === "saved") {
    return "No saved venues yet";
  }

  if (activeMode === "best") {
    return "No ratings yet";
  }

  if (activeMode === "live") {
    return "No current activity yet";
  }

  if (activeMode === "trending") {
    return "Nothing is trending yet";
  }

  return "No venues found";
}

function getEmptyText(activeMode: LeaderboardMode, activeFilter: LeaderboardFilter, userLocation: UserLocation | null) {
  if (activeMode === "best" && activeFilter !== "nearby") {
    return "Best rated needs community ratings. Open a venue detail page and add the first rating.";
  }

  if (activeFilter === "saved") {
    return "Save venues on this device from their detail pages to build My spots.";
  }

  if (activeFilter !== "nearby") {
    return activeMode === "live"
      ? "Try another energy or sound filter, or check again as venues warm up."
      : activeMode === "trending"
        ? "Trending appears when a venue has activity or is featured by Riento."
        : "Try another filter.";
  }

  if (!userLocation) {
    return "Tap Near me and allow foreground location to sort nearby venues. No crowd signal is sent.";
  }

  return "No known Helsinki venue is within the nearby radius. Try the All ranking instead.";
}

function formatDistance(distanceMeters: number) {
  return formatVenueDistance(distanceMeters) ?? "Distance unavailable";
}

function getVenueAccessibilityLabel(index: number, venue: Venue, distanceMeters?: number) {
  return [
    `Rank ${index + 1}, ${venue.name}`,
    getCrowdLabel(venue.crowdLevel, venue.hasLiveCrowdSignal),
    getVenueOpenStateLabel(venue.openingHours),
    distanceMeters === undefined ? null : `${formatDistance(distanceMeters)} away`,
    `Usually ${getVenueSoundLabels(venue.soundTags).join(", ")}`
  ].filter(Boolean).join(". ");
}

function getVenueDetailHref(venueId: string) {
  return { pathname: "/venue/[id]", params: { id: venueId } } as const;
}

function getCardAccentColor(activeMode: LeaderboardMode, venue: Venue) {
  if (activeMode === "best") {
    return colors.rose;
  }

  if (activeMode === "trending") {
    return venue.trendingRank ? colors.amber : colors.violet;
  }

  return getCrowdColor(venue.crowdLevel, venue.hasLiveCrowdSignal);
}

function getTrendingFallbackText(venue: Venue) {
  if (!venue.hasLiveCrowdSignal) {
    return "No live signal yet";
  }

  if (venue.crowdTrend === "rising") {
    return "Rising from recent venue signals";
  }

  if (venue.crowdTrend === "steady") {
    return "Holding steady tonight";
  }

  return "Worth watching based on live signal";
}

function formatVenueRating(venue: Venue) {
  if (!venue.averageRating || !venue.ratingCount) {
    return "No ratings yet";
  }

  return `${venue.averageRating.toFixed(1)}/5 from ${venue.ratingCount} ${venue.ratingCount === 1 ? "rating" : "ratings"}`;
}

const styles = StyleSheet.create({
  adminAction: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 82,
    paddingHorizontal: 12
  },
  adminActionRemove: {
    backgroundColor: colors.surface
  },
  adminActionText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900"
  },
  adminCard: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.amber,
    borderRadius: 22,
    borderWidth: 1,
    gap: 10,
    marginTop: 18,
    padding: 14
  },
  adminMessage: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 18
  },
  adminResults: {
    gap: 8
  },
  adminRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 16,
    flexDirection: "row",
    gap: 10,
    padding: 10
  },
  adminRowCopy: {
    flex: 1
  },
  adminSearch: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colors.text,
    minHeight: 46,
    paddingHorizontal: 12
  },
  adminText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18
  },
  adminTitle: {
    color: colors.amber,
    fontSize: 16,
    fontWeight: "900"
  },
  adminVenueMeta: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 3
  },
  adminVenueName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800"
  },
  buttonDisabled: {
    opacity: 0.45
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    padding: 16
  },
  cardHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between"
  },
  cardMain: {
    flex: 1
  },
  content: {
    paddingBottom: 32,
    paddingHorizontal: 20,
    paddingTop: 18
  },
  detail: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 10
  },
  discoveryMeta: {
    color: colors.amber,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 8
  },
  distanceText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 6
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: 18
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800"
  },
  errorText: {
    color: colors.warning,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12
  },
  countText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 12,
    textTransform: "uppercase"
  },
  filterChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    justifyContent: "center",
    minHeight: 44,
    paddingVertical: 9
  },
  filterChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  filterText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800"
  },
  filterTextActive: {
    color: colors.background
  },
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 20
  },
  filterLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
    marginTop: 18,
    textTransform: "uppercase"
  },
  filterScroller: {
    marginHorizontal: -20,
    marginTop: 8,
    paddingHorizontal: 20
  },
  horizontalFilters: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 40
  },
  kicker: {
    color: colors.amber,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.8,
    textTransform: "uppercase"
  },
  levelDot: {
    borderRadius: 4,
    height: 8,
    width: 8
  },
  levelPill: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6
  },
  levelText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800"
  },
  listHeader: {
    marginBottom: 24
  },
  listSeparator: {
    height: 12
  },
  locationMessage: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10
  },
  meta: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 6,
    textTransform: "capitalize"
  },
  nowPlayingText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 8
  },
  rankBadge: {
    alignItems: "center",
    backgroundColor: colors.surfaceElevated,
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36
  },
  rankText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800"
  },
  ratingText: {
    color: colors.rose,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 8
  },
  signalBar: {
    borderRadius: 999,
    height: "100%"
  },
  signalBarTrack: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 999,
    height: 8,
    marginTop: 14,
    overflow: "hidden"
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12
  },
  tapHint: {
    color: colors.amber,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 8,
    textTransform: "uppercase"
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -1.1,
    lineHeight: 39,
    marginTop: 8
  },
  trendText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 8
  },
  venueName: {
    color: colors.text,
    flex: 1,
    fontSize: 18,
    fontWeight: "800"
  },
  modeChip: {
    alignItems: "center",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 44,
    paddingVertical: 10
  },
  modeChipContainer: {
    flex: 1
  },
  modeChipActive: {
    backgroundColor: colors.accent
  },
  modeHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10
  },
  modeSwitch: {
    backgroundColor: colors.surface,
    borderColor: "rgba(240, 171, 252, 0.24)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    marginTop: 22,
    padding: 5
  },
  modeText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900"
  },
  modeTextActive: {
    color: colors.background
  },
  soundText: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 6
  },
  trendingHeadline: {
    color: colors.amber,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 8
  },
  warningText: {
    color: colors.amber,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10
  }
});
