import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import Constants from "expo-constants";
import * as Location from "expo-location";
import { useFocusEffect, useRouter } from "expo-router";
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from "../../src/components/RientoMap";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MotionPressable } from "../../src/components/MotionPressable";
import { useAuth } from "../../src/context/AuthContext";
import { getCrowdRingAsset, getVenueLogoAsset } from "../../src/data/venueLogoAssets";
import { useMusicRecognitionSettings } from "../../src/hooks/useMusicRecognitionSettings";
import { useProfileSettings } from "../../src/hooks/useProfileSettings";
import { useSavedVenueSlugs } from "../../src/hooks/useSavedVenueSlugs";
import { useVenues } from "../../src/hooks/useVenues";
import { getCrowdColor, getCrowdEmoji, getCrowdLabel, getCrowdScore } from "../../src/lib/crowd";
import { findClosestVenue, getDistanceMeters } from "../../src/lib/geo";
import { playSelectionHaptic, playSuccessHaptic } from "../../src/lib/haptics";
import { openVenueDirections } from "../../src/lib/mapDirections";
import { getNowPlayingText } from "../../src/lib/nowPlaying";
import { formatVenueDistance, getVenueOpenStateLabel, getVenueOpenStatePriority, getVenueSoundLabels, getVenueVibeColor, matchesVenueActivity, matchesVenueSound, type VenueActivityFilter, venueSoundLabels } from "../../src/lib/venueDiscovery";
import { createLaunchMusicCheckIntent } from "../../src/services/musicRecognitionService";
import { submitManualCheckin, submitVenuePing } from "../../src/services/venueService";
import { colors } from "../../src/theme/colors";
import { darkMapStyle } from "../../src/theme/mapStyle";
import { type Venue, type VenueKind, type VenueSoundTag } from "../../src/types/venue";

type MapFilter = "all" | "saved" | VenueKind;

const MAX_MAP_VENUES = 24;
let launchVenueCheckClaimed = false;

const MAP_FILTERS: { label: string; value: MapFilter }[] = [
  { label: "All", value: "all" },
  { label: "My spots", value: "saved" },
  { label: "Bars", value: "bar" },
  { label: "Clubs", value: "club" }
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

type UserLocation = {
  latitude: number;
  longitude: number;
};

type MapRegion = UserLocation & {
  latitudeDelta: number;
  longitudeDelta: number;
};

const HELSINKI_REGION: MapRegion = {
  latitude: 60.1699,
  latitudeDelta: 0.17,
  longitude: 24.9384,
  longitudeDelta: 0.24
};

const expoExtra = Constants.expoConfig?.extra as { androidGoogleMapsConfigured?: boolean } | undefined;
const isAndroidMapConfigured = Platform.OS !== "android" || expoExtra?.androidGoogleMapsConfigured === true;
const mapProvider = Platform.OS === "android" ? PROVIDER_GOOGLE : undefined;

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { height: windowHeight } = useWindowDimensions();
  const { ensureDeviceSession } = useAuth();
  const { error: musicSettingsError, isLoading: musicSettingsLoading, settings: musicSettings } = useMusicRecognitionSettings();
  const { error: profileSettingsError, isLoading: profileSettingsLoading, settings } = useProfileSettings();
  const { error: venueError, isLoading: venuesLoading, refresh, source, venues, warning: venueWarning } = useVenues();
  const { savedVenueSlugs } = useSavedVenueSlugs();
  const [activityFilter, setActivityFilter] = useState<VenueActivityFilter>("any");
  const [committedMapRegion, setCommittedMapRegion] = useState<MapRegion>(HELSINKI_REGION);
  const [dismissedMusicPromptVenueId, setDismissedMusicPromptVenueId] = useState<string | null>(null);
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  const [isManualPickerExpanded, setIsManualPickerExpanded] = useState(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [isLegendExpanded, setIsLegendExpanded] = useState(false);
  const [isLaunchCheckRunning, setIsLaunchCheckRunning] = useState(false);
  const [isLaunchCheckVisible, setIsLaunchCheckVisible] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const [locationState, setLocationState] = useState<"idle" | "checking" | "granted" | "denied">("idle");
  const [mapFilter, setMapFilter] = useState<MapFilter>("all");
  const [placedVenueId, setPlacedVenueId] = useState<string | null>(null);
  const [musicPromptVenueId, setMusicPromptVenueId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVenueSlug, setSelectedVenueSlug] = useState<string | null>(null);
  const [shouldShowAreaSearch, setShouldShowAreaSearch] = useState(false);
  const [signalMessage, setSignalMessage] = useState("Choose whether to check your venue and the song playing nearby.");
  const [soundFilter, setSoundFilter] = useState<VenueSoundTag | "any">("any");
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const mapRef = useRef<MapView | null>(null);
  const pendingMapRegion = useRef<MapRegion>(HELSINKI_REGION);
  const programmaticMapRegion = useRef<MapRegion | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (profileSettingsLoading || musicSettingsLoading) {
        setIsLaunchCheckVisible(false);
        return;
      }

      if (!isAndroidMapConfigured) {
        launchVenueCheckClaimed = true;
        setIsLaunchCheckVisible(false);
        setLocationState("denied");
        setSignalMessage("Android map setup needs a Google Maps API key before venue checks can run.");
        return;
      }

      if (profileSettingsError || musicSettingsError) {
        launchVenueCheckClaimed = true;
        setIsLaunchCheckVisible(false);
        setLocationState("denied");
        setSignalMessage("The launch check is paused because a saved preference could not be loaded.");
        return;
      }

      if (!settings.gpsOnMapOpen || !musicSettings.promptEnabled) {
        launchVenueCheckClaimed = true;
        setIsLaunchCheckVisible(false);
        setLocationState("idle");
        setSignalMessage("The app-open venue and song check is off in Settings.");
        return;
      }

      if (launchVenueCheckClaimed) {
        return;
      }

      launchVenueCheckClaimed = true;
      setIsLaunchCheckVisible(true);
      setSignalMessage("Check your nearby venue and song, or continue without sharing.");
    }, [musicSettings.promptEnabled, musicSettingsError, musicSettingsLoading, profileSettingsError, profileSettingsLoading, settings.gpsOnMapOpen])
  );

  async function handleLaunchVenueAndMusicCheck() {
    if (!isLaunchCheckVisible
      || !isAndroidMapConfigured
      || profileSettingsLoading
      || musicSettingsLoading
      || profileSettingsError
      || musicSettingsError
      || !settings.gpsOnMapOpen
      || !musicSettings.promptEnabled) {
      setIsLaunchCheckVisible(false);
      setLocationState("denied");
      setSignalMessage("The launch check is paused because its saved preferences are unavailable or off.");
      return;
    }

    setIsLaunchCheckRunning(true);
    setLocationState("checking");
    setSignalMessage("Finding a nearby venue...");

    try {
      const permission = await Location.requestForegroundPermissionsAsync();

      if (permission.status !== Location.PermissionStatus.GRANTED) {
        setLocationState("denied");
        setIsLaunchCheckVisible(false);
        setSignalMessage("Foreground location permission is off. Search and manual placement are still available.");
        return;
      }

      setLocationState("granted");
      const [currentLocation, venueResult] = await Promise.all([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        refresh()
      ]);
      const nextUserLocation = {
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude
      };
      setUserLocation(nextUserLocation);
      const closestVenue = findClosestVenue(nextUserLocation, venueResult?.venues ?? [], 120);

      if (!closestVenue) {
        setIsLaunchCheckVisible(false);
        setSignalMessage("Location found, but no supported venue is within 120 m.");
        return;
      }

      if (!closestVenue.venue.isRemote) {
        setIsLaunchCheckVisible(false);
        setSignalMessage(`Closest venue: ${closestVenue.venue.name}. Live checks are temporarily unavailable there.`);
        return;
      }

      const deviceSession = await ensureDeviceSession();

      if (!deviceSession.ok) {
        setSignalMessage(deviceSession.message);
        return;
      }

      const result = await submitVenuePing(closestVenue.venue.id, getSignalConfidence(closestVenue.distanceMeters));
      setSignalMessage(result.message);

      if (result.ok) {
        setPlacedVenueId(closestVenue.venue.id);
        setIsLaunchCheckVisible(false);
        playSuccessHaptic();
        const launchCheckToken = createLaunchMusicCheckIntent(closestVenue.venue.id);
        router.push(getVenueDetailHref(closestVenue.venue.slug, launchCheckToken));
      }
    } catch {
      setSignalMessage("Could not finish the venue check. Search and manual placement are still available.");
    } finally {
      setIsLaunchCheckRunning(false);
    }
  }

  function handleDismissLaunchCheck() {
    setIsLaunchCheckVisible(false);
    setSignalMessage("Venue and song check skipped for this app session.");
  }

  const normalizedSearchQuery = normalizeSearchText(searchQuery);
  const displayedVenues = venues.filter((venue) => {
    const matchesKind = mapFilter === "all" || mapFilter === "saved" || venue.kind === mapFilter;
    const matchesSavedFilter = mapFilter !== "saved" || savedVenueSlugs.has(venue.slug);
    const matchesSearch = matchesVenueSearch(venue, normalizedSearchQuery);

    return matchesKind && matchesSavedFilter && matchesSearch && matchesVenueActivity(venue, activityFilter) && matchesVenueSound(venue, soundFilter);
  });
  const areaVenues = displayedVenues.filter((venue) => isVenueInMapRegion(venue, committedMapRegion));
  const placementVenues = areaVenues
    .filter((venue) => venue.isRemote)
    .sort((left, right) => userLocation
      ? getDistanceMeters(userLocation, left) - getDistanceMeters(userLocation, right)
      : getCrowdScore(right) - getCrowdScore(left) || left.name.localeCompare(right.name))
    .slice(0, 3);
  const availableSoundTags = new Set<VenueSoundTag>(venues.flatMap((venue) => venue.soundTags).filter((tag) => tag !== "unknown"));
  const availableSoundFilters = SOUND_FILTERS.filter((filter) => filter.value === "any" || filter.value === soundFilter || availableSoundTags.has(filter.value));
  const placedVenue = venues.find((venue) => venue.id === placedVenueId);
  const musicPromptVenue = venues.find((venue) => venue.id === musicPromptVenueId) ?? null;
  const selectedVenue = venues.find((venue) => venue.slug === selectedVenueSlug) ?? null;
  const selectedVenueDistance = selectedVenue && userLocation ? getDistanceMeters(userLocation, selectedVenue) : undefined;
  const rankingNow = new Date();
  const topVenue = getMapRecommendation(areaVenues, userLocation, rankingNow);
  const reportVenueHref = { pathname: "/report-venue", params: normalizedSearchQuery ? { query: searchQuery.trim() } : {} } as const;
  const isSearchActive = isSearchExpanded || normalizedSearchQuery.length > 0;
  const filterSummary = [
    MAP_FILTERS.find((filter) => filter.value === mapFilter)?.label ?? "All",
    ACTIVITY_FILTERS.find((filter) => filter.value === activityFilter)?.label ?? "Any energy",
    availableSoundFilters.find((filter) => filter.value === soundFilter)?.label ?? "Any sound"
  ].join(" / ");
  const hasActiveFilters = mapFilter !== "all" || activityFilter !== "any" || soundFilter !== "any";
  const searchResults = normalizedSearchQuery
    ? [...displayedVenues]
      .sort((left, right) => getSearchResultRank(left, normalizedSearchQuery) - getSearchResultRank(right, normalizedSearchQuery)
        || getVenueOpenStatePriority(left.openingHours, rankingNow) - getVenueOpenStatePriority(right.openingHours, rankingNow)
        || compareVenueDistance(left, right, userLocation)
        || getCrowdScore(right) - getCrowdScore(left))
      .slice(0, 3)
    : [];
  const mapVenueLimit = getMapVenueLimit(committedMapRegion);
  const markerAreaVenues = selectedVenue
    && isVenueInMapRegion(selectedVenue, committedMapRegion)
    && !areaVenues.some((venue) => venue.id === selectedVenue.id)
    ? [...areaVenues, selectedVenue]
    : areaVenues;
  const mapMarkerVenues = getMapMarkerVenues(
    markerAreaVenues,
    normalizedSearchQuery,
    savedVenueSlugs,
    userLocation,
    committedMapRegion,
    selectedVenueSlug,
    searchResults.map((venue) => venue.id),
    rankingNow
  );
  const mapMarkerCountText = venuesLoading
    ? "Loading venues"
    : areaVenues.length === 0
      ? "No matching venues in this area"
      : areaVenues.length > mapMarkerVenues.length
        ? `${mapMarkerVenues.length} of ${areaVenues.length} shown / ${mapVenueLimit < MAX_MAP_VENUES ? "zoom in for more" : "use filters for more"}`
        : `${mapMarkerVenues.length} ${mapMarkerVenues.length === 1 ? "venue" : "venues"} in this area`;
  const shouldShowMusicPrompt =
    Boolean(musicPromptVenue) &&
    musicSettings.promptEnabled &&
    !musicSettingsLoading &&
    !isFilterExpanded &&
    !isSearchExpanded &&
    !selectedVenue &&
    dismissedMusicPromptVenueId !== musicPromptVenue?.id;

  function handleToggleSearch() {
    playSelectionHaptic();
    setIsManualPickerExpanded(false);
    setSelectedVenueSlug(null);

    if (isSearchExpanded) {
      setIsSearchExpanded(false);
      setSearchQuery("");
      return;
    }

    setIsSearchExpanded(true);
    setIsFilterExpanded(false);
    setIsLegendExpanded(false);
  }

  function handleToggleFilters() {
    playSelectionHaptic();
    setIsFilterExpanded((value) => !value);
    setIsLegendExpanded(false);
    setIsSearchExpanded(false);
    setIsManualPickerExpanded(false);
    setSelectedVenueSlug(null);
    setSearchQuery("");
  }

  function handleResetFilters() {
    if (hasActiveFilters) {
      playSelectionHaptic();
    }

    setMapFilter("all");
    setActivityFilter("any");
    setSoundFilter("any");
  }

  async function handleManualPlacement(venue: Venue) {
    setSelectedVenueSlug(null);
    setIsManualPickerExpanded(false);
    setMusicPromptVenueId(null);

    if (profileSettingsLoading || profileSettingsError || !settings.manualPlacementEnabled) {
      setSignalMessage(profileSettingsLoading || profileSettingsError
        ? "Manual placement is paused because its saved preference is unavailable."
        : "Manual placement is paused in Settings.");
      return;
    }

    if (!venue.isRemote) {
      setSignalMessage(`Live placement is temporarily unavailable for ${venue.name}.`);
      return;
    }

    try {
      setIsSubmittingManual(true);
      const deviceSession = await ensureDeviceSession();

      if (!deviceSession.ok) {
        setSignalMessage(deviceSession.message);
        return;
      }

      const result = await submitManualCheckin(venue.id);
      setSignalMessage(result.message);

      if (result.ok) {
        setPlacedVenueId(venue.id);

        if (dismissedMusicPromptVenueId !== venue.id) {
          setDismissedMusicPromptVenueId(null);
        }

        setMusicPromptVenueId(musicSettings.promptEnabled && !musicSettingsLoading && !musicSettingsError && dismissedMusicPromptVenueId !== venue.id ? venue.id : null);
        playSuccessHaptic();
      }
    } finally {
      setIsSubmittingManual(false);
    }
  }

  function handleDismissInlineMusicPrompt() {
    if (musicPromptVenue) {
      setDismissedMusicPromptVenueId(musicPromptVenue.id);
    }

    setMusicPromptVenueId(null);
  }

  function handleOpenVenueMusicCheck(venue: Venue) {
    setDismissedMusicPromptVenueId(venue.id);
    setMusicPromptVenueId(null);
    setSelectedVenueSlug(null);
    router.push(getVenueDetailHref(venue.slug));
  }

  function handleToggleManualPicker() {
    playSelectionHaptic();
    setIsManualPickerExpanded((value) => !value);
    setMusicPromptVenueId(null);
    setSelectedVenueSlug(null);
  }

  function handleSelectVenue(venueSlug: string) {
    if (selectedVenueSlug !== venueSlug) {
      playSelectionHaptic();
    }

    setIsFilterExpanded(false);
    setIsLegendExpanded(false);
    setIsSearchExpanded(false);
    setSearchQuery("");
    setSelectedVenueSlug((currentVenueSlug) => currentVenueSlug === venueSlug ? null : venueSlug);
  }

  function handleDismissSelectedVenue() {
    setSelectedVenueSlug(null);
  }

  function handleMapPress() {
    if (selectedVenueSlug) {
      handleDismissSelectedVenue();
    }
  }

  function moveMapToRegion(region: MapRegion) {
    programmaticMapRegion.current = region;
    pendingMapRegion.current = region;
    setShouldShowAreaSearch(false);
    setCommittedMapRegion(region);
    mapRef.current?.animateToRegion(region, reduceMotion ? 0 : 260);
  }

  function focusVenue(venue: Venue) {
    playSelectionHaptic();
    setSelectedVenueSlug(venue.slug);
    setIsManualPickerExpanded(false);
    setMusicPromptVenueId(null);
    setIsSearchExpanded(false);
    setIsFilterExpanded(false);
    setSearchQuery("");
    Keyboard.dismiss();
    moveMapToRegion({
      latitude: venue.latitude,
      latitudeDelta: 0.018,
      longitude: venue.longitude,
      longitudeDelta: 0.018
    });
  }

  function handleMapRegionChangeComplete(region: MapRegion) {
    const expectedRegion = programmaticMapRegion.current;

    if (expectedRegion && areMapRegionsEquivalent(region, expectedRegion)) {
      programmaticMapRegion.current = null;
      pendingMapRegion.current = region;
      setShouldShowAreaSearch(false);
      setCommittedMapRegion(region);
      return;
    }

    programmaticMapRegion.current = null;
    pendingMapRegion.current = region;
    setShouldShowAreaSearch(hasMapRegionChanged(committedMapRegion, region));
  }

  function handleSearchThisArea() {
    playSelectionHaptic();
    programmaticMapRegion.current = null;
    setSelectedVenueSlug(null);
    setShouldShowAreaSearch(false);
    setCommittedMapRegion(pendingMapRegion.current);
  }

  async function handleOpenDirections(venue: Venue) {
    const result = await openVenueDirections(venue);

    if (!result.ok) {
      setSignalMessage(result.message);
    }
  }

  async function handleRecenter() {
    setIsLocating(true);

    try {
      let permission = await Location.getForegroundPermissionsAsync();

      if (permission.status !== Location.PermissionStatus.GRANTED) {
        permission = await Location.requestForegroundPermissionsAsync();
      }

      if (permission.status !== Location.PermissionStatus.GRANTED) {
        setSignalMessage("Location permission is off. You can still search and place yourself manually.");
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const nextLocation = {
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude
      };
      setUserLocation(nextLocation);
      setLocationState("granted");
      setSignalMessage("Map centered near you. No activity signal was sent by this action.");
      moveMapToRegion({ ...nextLocation, latitudeDelta: 0.035, longitudeDelta: 0.035 });
    } catch {
      setSignalMessage("Could not get your location. Search and manual placement are still available.");
    } finally {
      setIsLocating(false);
    }
  }

  function handleMapFilterPress(filter: MapFilter) {
    if (mapFilter !== filter) {
      playSelectionHaptic();
    }

    setMapFilter(filter);
  }

  function handleToggleLegend() {
    setIsLegendExpanded((value) => !value);
    setIsFilterExpanded(false);
    setIsSearchExpanded(false);
    setSearchQuery("");
  }

  function handleReportMissing() {
    router.push(reportVenueHref);
  }

  useEffect(() => {
    if (selectedVenueSlug && (!selectedVenue || !isVenueInMapRegion(selectedVenue, committedMapRegion))) {
      setSelectedVenueSlug(null);
    }
  }, [committedMapRegion.latitude, committedMapRegion.latitudeDelta, committedMapRegion.longitude, committedMapRegion.longitudeDelta, selectedVenue, selectedVenueSlug]);

  return (
    <View style={styles.container}>
      {isAndroidMapConfigured ? (
        <MapView
          customMapStyle={Platform.OS === "android" ? darkMapStyle : undefined}
          initialRegion={HELSINKI_REGION}
          mapType={Platform.OS === "ios" ? "mutedStandard" : "standard"}
          onMapReady={() => undefined}
          onPress={handleMapPress}
          onRegionChangeComplete={handleMapRegionChangeComplete}
          provider={mapProvider}
          ref={mapRef}
          showsBuildings={Platform.OS === "ios" ? false : undefined}
          showsCompass={Platform.OS === "ios" ? false : undefined}
          showsUserLocation={locationState === "granted"}
          showsMyLocationButton={false}
          showsPointsOfInterest={Platform.OS === "ios" ? false : undefined}
          showsTraffic={Platform.OS === "ios" ? false : undefined}
          style={styles.map}
          toolbarEnabled={false}
          userInterfaceStyle={Platform.OS === "ios" ? "dark" : undefined}
        >
          {mapMarkerVenues.map((venue) => {
            const crowdColor = getCrowdColor(venue.crowdLevel, venue.hasLiveCrowdSignal);
            const isSelected = selectedVenueSlug === venue.slug;
            const logoAsset = getVenueLogoAsset(venue.slug);
            const coordinate = { latitude: venue.latitude, longitude: venue.longitude };

            return (
              <Fragment key={venue.slug}>
                {venue.hasLiveCrowdSignal && (
                  <Circle
                    center={coordinate}
                    fillColor={`${crowdColor}24`}
                    key={`${venue.slug}-crowd-area`}
                    radius={venue.crowdLevel === "packed" ? 230 : venue.crowdLevel === "busy" ? 180 : 130}
                    strokeColor={`${crowdColor}88`}
                    strokeWidth={1}
                  />
                )}
                {logoAsset ? (
                  <>
                    {venue.hasLiveCrowdSignal && (
                      <Marker
                        accessibilityElementsHidden
                        anchor={{ x: 0.5, y: 0.5 }}
                        accessible={false}
                        coordinate={coordinate}
                        image={getCrowdRingAsset(venue.crowdLevel)}
                        importantForAccessibility="no"
                        key={`${venue.slug}-crowd-ring`}
                        onPress={() => handleSelectVenue(venue.slug)}
                        stopPropagation
                        tracksViewChanges={false}
                        zIndex={1}
                      />
                    )}
                    <Marker
                      accessibilityHint="Selects this venue and shows venue actions"
                      accessibilityLabel={`${venue.name}, ${getCrowdLabel(venue.crowdLevel, venue.hasLiveCrowdSignal)}, ${venue.neighborhood}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      anchor={{ x: 0.5, y: 0.5 }}
                      coordinate={coordinate}
                      image={logoAsset}
                      identifier={`venue-${venue.slug}`}
                      key={`${venue.slug}-logo`}
                      onPress={() => handleSelectVenue(venue.slug)}
                      stopPropagation
                      tracksViewChanges={false}
                      zIndex={2}
                    />
                  </>
                ) : (
                  <Marker
                    accessibilityHint="Selects this venue and shows venue actions"
                    accessibilityLabel={`${venue.name}, ${getCrowdLabel(venue.crowdLevel, venue.hasLiveCrowdSignal)}, ${venue.neighborhood}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    coordinate={coordinate}
                    identifier={`venue-${venue.slug}`}
                    key={`${venue.slug}-pin`}
                    onPress={() => handleSelectVenue(venue.slug)}
                    pinColor={crowdColor}
                    stopPropagation
                    zIndex={1}
                  />
                )}
              </Fragment>
            );
          })}
        </MapView>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.mapUnavailable]}>
          <Text style={styles.mapUnavailableText}>Android map setup needs a Google Maps API key before this build can show the map.</Text>
        </View>
      )}

      {isAndroidMapConfigured && shouldShowAreaSearch && (
        <View pointerEvents="box-none" style={[styles.searchAreaContainer, { top: insets.top + 212 }]}>
          <MotionPressable accessibilityHint="Shows venues in the visible map area" accessibilityLabel="Search this map area" accessibilityRole="button" onPress={handleSearchThisArea} style={styles.searchAreaButton}>
            <Text style={styles.searchAreaButtonText}>Search this area</Text>
          </MotionPressable>
        </View>
      )}

      <View style={[styles.topPanel, { top: insets.top + 8 }]}>
        <ScrollView bounces={false} contentContainerStyle={styles.panelScrollContent} keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator={false} style={{ maxHeight: windowHeight * 0.45 }}>
        <View style={styles.topHeaderRow}>
          <View style={styles.topHeaderCopy}>
            <Text style={styles.kicker}>Riento Helsinki</Text>
            <Text style={styles.compactMeta}>{mapMarkerCountText}</Text>
          </View>
          <View style={styles.topHeaderActions}>
            <Pressable accessibilityLabel="Center map near me" accessibilityRole="button" accessibilityState={{ busy: isLocating }} disabled={isLocating} onPress={handleRecenter} style={styles.searchToggle}>
              <Text style={styles.searchToggleText}>{isLocating ? "Finding..." : "Locate"}</Text>
            </Pressable>
            <Pressable accessibilityLabel={isSearchActive ? "Close venue search" : "Search venues"} accessibilityRole="button" accessibilityState={{ expanded: isSearchExpanded }} onPress={handleToggleSearch} style={[styles.searchToggle, isSearchActive && styles.searchToggleActive]}>
              <Text style={[styles.searchToggleText, isSearchActive && styles.searchToggleTextActive]}>{isSearchActive ? "Close" : "Search"}</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.filterDropdown}>
          <MotionPressable accessibilityHint="Shows venue, energy, and sound choices" accessibilityLabel={`Filters, ${filterSummary}`} accessibilityRole="button" accessibilityState={{ expanded: isFilterExpanded }} onPress={handleToggleFilters} style={[styles.filterDropdownButton, (isFilterExpanded || hasActiveFilters) && styles.filterDropdownButtonActive]}>
            <View style={styles.filterDropdownCopy}>
              <Text style={styles.filterDropdownLabel}>Filters</Text>
              <Text numberOfLines={1} style={styles.filterDropdownSummary}>{filterSummary}</Text>
            </View>
            <Text style={styles.filterDropdownAction}>{isFilterExpanded ? "Hide" : "Choose"}</Text>
          </MotionPressable>
          {isFilterExpanded && (
            <View accessibilityLabel="Map filter choices" style={styles.filterDropdownMenu}>
              <View style={styles.filterMenuHeader}>
                <Text style={styles.filterGroupLabel}>Venue</Text>
                {hasActiveFilters && (
                  <Pressable accessibilityLabel="Reset all map filters" accessibilityRole="button" onPress={handleResetFilters} style={styles.filterResetButton}>
                    <Text style={styles.filterResetText}>Reset</Text>
                  </Pressable>
                )}
              </View>
              <ScrollView accessibilityLabel="Venue filters" horizontal showsHorizontalScrollIndicator={false} style={styles.mapFilterScrollerCompact}>
                <View style={styles.mapFilters}>
                  {MAP_FILTERS.map((filter) => {
                    const isActive = mapFilter === filter.value;

                    return (
                      <MotionPressable accessibilityRole="button" accessibilityState={{ selected: isActive }} key={filter.value} onPress={() => handleMapFilterPress(filter.value)} style={[styles.mapFilterChip, isActive && styles.mapFilterChipActive]}>
                        <Text style={[styles.mapFilterText, isActive && styles.mapFilterTextActive]}>{filter.label}</Text>
                      </MotionPressable>
                    );
                  })}
                </View>
              </ScrollView>
              <Text style={styles.filterGroupLabel}>Energy</Text>
              <ScrollView accessibilityLabel="Activity filters" horizontal showsHorizontalScrollIndicator={false} style={styles.mapFilterScrollerCompact}>
                <View style={styles.mapFilters}>
                  {ACTIVITY_FILTERS.map((filter) => {
                    const isActive = activityFilter === filter.value;
                    return (
                      <MotionPressable accessibilityRole="button" accessibilityState={{ selected: isActive }} key={filter.value} onPress={() => setActivityFilter(filter.value)} style={[styles.mapFilterChip, isActive && styles.mapFilterChipActive]}>
                        <Text style={[styles.mapFilterText, isActive && styles.mapFilterTextActive]}>{filter.label}</Text>
                      </MotionPressable>
                    );
                  })}
                </View>
              </ScrollView>
              <Text style={styles.filterGroupLabel}>Sound</Text>
              <ScrollView accessibilityLabel="Sound filters" horizontal showsHorizontalScrollIndicator={false} style={styles.mapFilterScrollerCompact}>
                <View style={styles.mapFilters}>
                  {availableSoundFilters.map((filter) => {
                    const isActive = soundFilter === filter.value;
                    return (
                      <MotionPressable accessibilityRole="button" accessibilityState={{ selected: isActive }} key={filter.value} onPress={() => setSoundFilter(filter.value)} style={[styles.mapFilterChip, isActive && styles.mapFilterChipActive]}>
                        <Text style={[styles.mapFilterText, isActive && styles.mapFilterTextActive]}>{filter.label}</Text>
                      </MotionPressable>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          )}
        </View>
        <View style={styles.mapInsightRow}>
          {topVenue ? (
            <Pressable accessibilityHint="Selects and centers this venue" accessibilityLabel={topVenue.hasLiveCrowdSignal ? `Right now, ${topVenue.name}, ${getCrowdLabel(topVenue.crowdLevel, true)}` : `Tonight, ${topVenue.name}, best available without a live signal`} accessibilityRole="button" onPress={() => focusVenue(topVenue)} style={styles.mapInsightButton}>
              <Text style={styles.mapInsightLabel}>{topVenue.hasLiveCrowdSignal ? "Right now" : "Tonight"}</Text>
              <Text numberOfLines={1} style={styles.mapInsightText}>{topVenue.name} / {topVenue.hasLiveCrowdSignal ? getCrowdLabel(topVenue.crowdLevel, true) : "Best available"}</Text>
            </Pressable>
          ) : (
            <View style={styles.mapInsightButton}>
              <Text style={styles.mapInsightLabel}>This area</Text>
              <Text style={styles.mapInsightText}>{areaVenues.length > 0 ? "No open venue found" : "Move the map to explore"}</Text>
            </View>
          )}
          <Pressable accessibilityLabel="Activity legend" accessibilityRole="button" accessibilityState={{ expanded: isLegendExpanded }} onPress={handleToggleLegend} style={styles.legendButton}>
            <Text style={styles.legendButtonText}>Legend</Text>
          </Pressable>
        </View>
        {isLegendExpanded && (
          <ScrollView accessibilityLabel="Activity level legend" horizontal showsHorizontalScrollIndicator={false} style={styles.legendScroller}>
            <View style={styles.legendRow}>
              {([false, "quiet", "active", "busy", "packed"] as const).map((level) => {
                const hasSignal = level !== false;
                const crowdLevel = level === false ? "quiet" : level;
                return <Text key={String(level)} style={styles.legendItem}>{getCrowdEmoji(crowdLevel, hasSignal)} {getCrowdLabel(crowdLevel, hasSignal)}</Text>;
              })}
            </View>
          </ScrollView>
        )}
        {isSearchExpanded && (
          <View style={styles.searchExpanded}>
            <Text style={styles.subtitle}>{getVenueSourceText(source, venues.length, venuesLoading)}</Text>
            <View style={styles.searchBox}>
              <TextInput
                accessibilityLabel="Search venues"
                autoCapitalize="none"
                autoFocus
                onChangeText={setSearchQuery}
                placeholder="Search venue, area, street"
                placeholderTextColor={colors.muted}
                style={styles.searchInput}
                value={searchQuery}
              />
            </View>
            {normalizedSearchQuery && (
              <View style={styles.searchResults}>
                {searchResults.length > 0 ? searchResults.map((venue) => {
                  const distance = userLocation ? formatVenueDistance(getDistanceMeters(userLocation, venue)) : undefined;
                  return (
                    <Pressable accessibilityHint="Selects and centers this venue" accessibilityLabel={`${venue.name}, ${venue.neighborhood}, ${getVenueOpenStateLabel(venue.openingHours)}, ${getCrowdLabel(venue.crowdLevel, venue.hasLiveCrowdSignal)}`} accessibilityRole="button" key={venue.id} onPress={() => focusVenue(venue)} style={styles.searchResultRow}>
                      <View style={styles.searchResultCopy}>
                        <Text style={styles.searchResultName}>{venue.name}</Text>
                        <Text style={styles.searchResultMeta}>{venue.neighborhood} / {getVenueOpenStateLabel(venue.openingHours)}{distance ? ` / ${distance}` : ""}</Text>
                      </View>
                      <Text style={styles.searchResultActivity}>{getCrowdEmoji(venue.crowdLevel, venue.hasLiveCrowdSignal)} {getCrowdLabel(venue.crowdLevel, venue.hasLiveCrowdSignal)}</Text>
                    </Pressable>
                  );
                }) : <Text style={styles.emptyText}>No venues match this search and these filters.</Text>}
              </View>
            )}
            <View style={styles.searchMetaRow}>
              <Text accessibilityLiveRegion="polite" style={styles.resultCount}>{displayedVenues.length} matching {displayedVenues.length === 1 ? "venue" : "venues"}</Text>
              <Pressable accessibilityLabel="Report a missing venue" accessibilityRole="button" onPress={handleReportMissing} style={styles.reportMissingButton}>
                <Text style={styles.reportMissingText}>Report missing</Text>
              </Pressable>
            </View>
          </View>
        )}
        </ScrollView>
      </View>

      <View style={styles.bottomPanel}>
        <ScrollView bounces={false} contentContainerStyle={styles.panelScrollContent} nestedScrollEnabled showsVerticalScrollIndicator={false} style={{ maxHeight: windowHeight * 0.4 }}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, locationState === "granted" ? styles.statusGranted : styles.statusDenied]} />
          <Text style={styles.statusText}>{getLocationStatusText(locationState, settings.gpsOnMapOpen)}</Text>
        </View>

        {isLaunchCheckVisible ? (
          <LaunchCheckCard
            isRunning={isLaunchCheckRunning}
            onCheck={handleLaunchVenueAndMusicCheck}
            onDismiss={handleDismissLaunchCheck}
          />
        ) : shouldShowMusicPrompt && musicPromptVenue ? (
          <MusicPromptCard
            onDismiss={handleDismissInlineMusicPrompt}
            onOpenMusicCheck={() => handleOpenVenueMusicCheck(musicPromptVenue)}
            venue={musicPromptVenue}
          />
        ) : selectedVenue ? (
          <SelectedVenueCard
            disabled={isSubmittingManual || profileSettingsLoading || Boolean(profileSettingsError) || !settings.manualPlacementEnabled || !selectedVenue.isRemote}
            distanceMeters={selectedVenueDistance}
            isSelected={placedVenueId === selectedVenue.id}
            onDismiss={handleDismissSelectedVenue}
            onOpenDirections={() => handleOpenDirections(selectedVenue)}
            onOpenDetails={() => router.push(getVenueDetailHref(selectedVenue.slug))}
            onPlaceHere={() => handleManualPlacement(selectedVenue)}
            venue={selectedVenue}
          />
        ) : (
          <>
            {placedVenue && !isManualPickerExpanded ? (
              <View style={styles.manualSummaryRow}>
                <View style={styles.manualPromptCopy}>
                  <Text style={styles.manualPromptLabel}>Placed at {placedVenue.name}</Text>
                  <Text style={styles.manualPromptText}>Your venue signal is set. Keep exploring the map.</Text>
                </View>
                <Pressable accessibilityLabel="Change manual venue placement" accessibilityRole="button" onPress={handleToggleManualPicker} style={styles.manualPromptButton}>
                  <Text style={styles.manualPromptButtonText}>Change</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.manualPromptRow}>
                <View style={styles.manualPromptCopy}>
                  <Text style={styles.manualPromptLabel}>Manual placement</Text>
                  <Text style={styles.manualPromptText}>Use this if GPS misses the venue.</Text>
                </View>
                <Pressable accessibilityLabel={isManualPickerExpanded ? "Hide manual venue choices" : "Show manual venue choices"} accessibilityRole="button" accessibilityState={{ expanded: isManualPickerExpanded }} onPress={handleToggleManualPicker} style={styles.manualPromptButton}>
                  <Text style={styles.manualPromptButtonText}>{isManualPickerExpanded ? "Hide" : "Place manually"}</Text>
                </Pressable>
              </View>
            )}
            {isManualPickerExpanded && (
              <View style={styles.venueChips}>
                {placementVenues.length > 0 ? (
                  placementVenues.map((venue) => (
                    <Pressable
                      accessibilityLabel={`Place me at ${venue.name}`}
                      accessibilityRole="button"
                      disabled={isSubmittingManual || profileSettingsLoading || Boolean(profileSettingsError) || !settings.manualPlacementEnabled}
                      key={venue.id}
                      onPress={() => handleManualPlacement(venue)}
                      style={[styles.chip, placedVenueId === venue.id && styles.chipSelected, (profileSettingsLoading || Boolean(profileSettingsError) || !settings.manualPlacementEnabled) && styles.chipDisabled]}
                    >
                      <Text style={[styles.chipText, placedVenueId === venue.id && styles.chipTextSelected]}>{venue.name}</Text>
                    </Pressable>
                  ))
                ) : (
                  <Text style={styles.emptyText}>No live venue rows match these filters. Search or select a marker to choose another venue.</Text>
                )}
              </View>
            )}
          </>
        )}

        {(venueError || venueWarning) && <Text accessibilityLiveRegion="polite" style={styles.warningText}>{venueError ?? venueWarning}</Text>}
        <Text accessibilityLiveRegion="polite" style={styles.helperText}>{signalMessage}</Text>
        </ScrollView>
      </View>
    </View>
  );
}

type SelectedVenueCardProps = {
  disabled: boolean;
  distanceMeters?: number;
  isSelected: boolean;
  onDismiss: () => void;
  onOpenDirections: () => void;
  onOpenDetails: () => void;
  onPlaceHere: () => void;
  venue: Venue;
};

function SelectedVenueCard({ disabled, distanceMeters, isSelected, onDismiss, onOpenDirections, onOpenDetails, onPlaceHere, venue }: SelectedVenueCardProps) {
  const crowdColor = getCrowdColor(venue.crowdLevel, venue.hasLiveCrowdSignal);
  const vibeColor = getVenueVibeColor(venue);

  return (
    <View style={[styles.selectedVenueCard, { borderColor: `${crowdColor}66` }]}>
      <View style={styles.selectedVenueHeader}>
        <View style={styles.selectedVenueCopy}>
          <Text style={styles.selectedVenueLabel}>Selected venue</Text>
          <Text style={styles.selectedVenueName}>{venue.name}</Text>
          <Text style={styles.selectedVenueMeta}>{venue.neighborhood} / {venue.address}</Text>
        </View>
        <Pressable accessibilityLabel={`Close information for ${venue.name}`} accessibilityRole="button" hitSlop={8} onPress={onDismiss} style={styles.selectedVenueCloseButton}>
          <Text style={styles.selectedVenueCloseButtonText}>Close</Text>
        </Pressable>
      </View>
      <View style={[styles.selectedVenuePill, { backgroundColor: `${crowdColor}18`, borderColor: crowdColor }]}>
        <Text style={styles.selectedVenuePillText}>{getCrowdEmoji(venue.crowdLevel, venue.hasLiveCrowdSignal)} {getCrowdLabel(venue.crowdLevel, venue.hasLiveCrowdSignal)}</Text>
      </View>

      <View style={[styles.selectedVenueVibeCard, { backgroundColor: `${vibeColor}18`, borderColor: `${vibeColor}70` }]}>
        <Text style={[styles.selectedVenueVibeLabel, { color: vibeColor }]}>Vibe</Text>
        <Text style={styles.selectedVenueVibe}>{venue.vibe}</Text>
      </View>
      <Text style={styles.selectedVenueDiscoveryText}>{getVenueOpenStateLabel(venue.openingHours)}{distanceMeters === undefined ? "" : ` / ${formatVenueDistance(distanceMeters)}`}</Text>
      <Text style={styles.selectedVenueSoundText}>Usually: {getVenueSoundLabels(venue.soundTags).join(", ")}</Text>
      {venue.averageRating && <Text style={styles.selectedVenueRatingText}>{formatVenueRating(venue)}</Text>}
      {venue.trendingHeadline && <Text style={styles.selectedVenueTrendingText}>Trending: {venue.trendingHeadline}</Text>}
      <Text style={styles.selectedVenueNowPlaying}>Now playing: {getNowPlayingText(venue.nowPlaying)}</Text>

      <View style={styles.selectedVenueActions}>
        <Pressable accessibilityLabel={`Open details for ${venue.name}`} accessibilityRole="button" onPress={onOpenDetails} style={[styles.selectedVenueAction, styles.selectedVenueSecondaryAction]}>
          <Text style={[styles.selectedVenueActionText, styles.selectedVenueSecondaryActionText]}>Details</Text>
        </Pressable>
        <Pressable accessibilityLabel={`Open walking directions to ${venue.name}`} accessibilityRole="button" onPress={onOpenDirections} style={[styles.selectedVenueAction, styles.selectedVenuePrimaryAction, { backgroundColor: crowdColor }]}>
          <Text style={styles.selectedVenueActionText}>Directions</Text>
        </Pressable>
      </View>
      <Pressable accessibilityLabel={`Place me at ${venue.name}`} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPlaceHere} style={[styles.selectedVenueAction, styles.selectedVenuePlaceAction, disabled && styles.selectedVenueActionDisabled]}>
        <Text style={[styles.selectedVenueActionText, styles.selectedVenueSecondaryActionText]}>{isSelected ? "Placement selected" : "Place me here"}</Text>
      </Pressable>

    </View>
  );
}

type MusicPromptCardProps = {
  onDismiss: () => void;
  onOpenMusicCheck: () => void;
  venue: Venue;
};

type LaunchCheckCardProps = {
  isRunning: boolean;
  onCheck: () => void;
  onDismiss: () => void;
};

function LaunchCheckCard({ isRunning, onCheck, onDismiss }: LaunchCheckCardProps) {
  return (
    <View style={styles.inlineMusicPrompt}>
      <Text style={styles.inlineMusicKicker}>Quick accuracy check</Text>
      <Text style={styles.inlineMusicTitle}>Check your venue and song?</Text>
      <Text style={styles.inlineMusicText}>Riento uses foreground location to suggest a nearby venue. This button then opens one short, foreground-only music check; nothing listens in the background.</Text>
      <View style={styles.inlineMusicActions}>
        <Pressable accessibilityRole="button" disabled={isRunning} onPress={onDismiss} style={[styles.inlineMusicButton, styles.inlineMusicSecondary, isRunning && styles.buttonDisabled]}>
          <Text style={styles.inlineMusicSecondaryText}>Not now</Text>
        </Pressable>
        <Pressable accessibilityLabel="Check nearby venue and song" accessibilityRole="button" accessibilityState={{ busy: isRunning }} disabled={isRunning} onPress={onCheck} style={[styles.inlineMusicButton, styles.inlineMusicPrimary, isRunning && styles.buttonDisabled]}>
          <Text style={styles.inlineMusicPrimaryText}>{isRunning ? "Finding venue..." : "Check venue & song"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MusicPromptCard({ onDismiss, onOpenMusicCheck, venue }: MusicPromptCardProps) {
  return (
    <View style={styles.inlineMusicPrompt}>
      <Text style={styles.inlineMusicKicker}>Placed at {venue.name}</Text>
      <Text style={styles.inlineMusicTitle}>Add what is playing?</Text>
      <Text style={styles.inlineMusicText}>Optional and foreground-only. This prompt collapses after this choice.</Text>
      <View style={styles.inlineMusicActions}>
        <Pressable accessibilityRole="button" onPress={onDismiss} style={[styles.inlineMusicButton, styles.inlineMusicSecondary]}>
          <Text style={styles.inlineMusicSecondaryText}>Not now</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onOpenMusicCheck} style={[styles.inlineMusicButton, styles.inlineMusicPrimary]}>
          <Text style={styles.inlineMusicPrimaryText}>Check music</Text>
        </Pressable>
      </View>
    </View>
  );
}

function getVenueDetailHref(venueId: string, launchCheckToken?: string) {
  return { pathname: "/venue/[id]", params: { id: venueId, ...(launchCheckToken ? { launchCheck: launchCheckToken } : {}) } } as const;
}

function getSignalConfidence(distanceMeters: number) {
  return Math.max(0.25, Math.min(1, 1 - distanceMeters / 160));
}

function getLocationStatusText(locationState: "idle" | "checking" | "granted" | "denied", automaticSharingEnabled: boolean) {
  if (locationState === "idle") {
    return automaticSharingEnabled ? "Venue and song check available" : "App-open venue check is off";
  }

  if (locationState === "checking") {
    return "Refreshing location signal";
  }

  if (locationState === "granted") {
    return automaticSharingEnabled ? "Foreground activity sharing is on" : "Location used on this device only";
  }

  return automaticSharingEnabled ? "Location permission is off. Manual placement is available." : "Automatic activity sharing is off.";
}

function getVenueSourceText(source: "local" | "supabase", venueCount: number, isLoading: boolean) {
  if (isLoading) {
    return "Loading Helsinki venues and crowd labels...";
  }

  if (source === "supabase") {
    return `Showing ${venueCount} Helsinki venues with current venue-level signals.`;
  }

  return `Showing ${venueCount} provisional local venues while live data is unavailable.`;
}

function formatVenueRating(venue: Venue) {
  if (!venue.averageRating || !venue.ratingCount) {
    return "No ratings yet";
  }

  return `${venue.averageRating.toFixed(1)}/5 from ${venue.ratingCount} ${venue.ratingCount === 1 ? "rating" : "ratings"}`;
}

function matchesVenueSearch(venue: Venue, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  const searchableText = normalizeSearchText([venue.name, venue.neighborhood, venue.address, venue.kind, venue.vibe, ...getVenueSoundLabels(venue.soundTags), "Helsinki"].join(" "));

  if (searchableText.includes(normalizedQuery)) {
    return true;
  }

  const searchableTokens = getSearchTokens(searchableText);
  return getSearchTokens(normalizedQuery).every((queryToken) => searchableTokens.some((searchableToken) => isSearchTokenMatch(queryToken, searchableToken)));
}

function getSearchResultRank(venue: Venue, normalizedQuery: string) {
  const normalizedName = normalizeSearchText(venue.name);

  if (normalizedName === normalizedQuery) {
    return 0;
  }

  if (normalizedName.startsWith(normalizedQuery)) {
    return 1;
  }

  return 2;
}

function compareVenueDistance(left: Venue, right: Venue, location: UserLocation | null) {
  if (!location) {
    return 0;
  }

  return getDistanceMeters(location, left) - getDistanceMeters(location, right);
}

function getMapMarkerVenues(
  venues: Venue[],
  normalizedQuery: string,
  savedVenueSlugs: Set<string>,
  userLocation: UserLocation | null,
  region: MapRegion,
  selectedVenueSlug: string | null,
  requiredVenueIds: string[],
  now: Date
) {
  const limit = getMapVenueLimit(region);
  const rankedVenues = venues
    .map((venue) => ({
      distance: userLocation ? getDistanceMeters(userLocation, venue) : 0,
      openPriority: getVenueOpenStatePriority(venue.openingHours, now),
      venue
    }))
    .sort((left, right) =>
      getSearchResultRank(left.venue, normalizedQuery) - getSearchResultRank(right.venue, normalizedQuery) ||
      Number(right.venue.hasLiveCrowdSignal) - Number(left.venue.hasLiveCrowdSignal) ||
      getCrowdScore(right.venue) - getCrowdScore(left.venue) ||
      getMapTrendWeight(right.venue) - getMapTrendWeight(left.venue) ||
      (left.venue.trendingRank ?? Number.MAX_SAFE_INTEGER) - (right.venue.trendingRank ?? Number.MAX_SAFE_INTEGER) ||
      left.openPriority - right.openPriority ||
      Number(savedVenueSlugs.has(right.venue.slug)) - Number(savedVenueSlugs.has(left.venue.slug)) ||
      (right.venue.ratingCount ?? 0) - (left.venue.ratingCount ?? 0) ||
      (right.venue.averageRating ?? 0) - (left.venue.averageRating ?? 0) ||
      left.distance - right.distance ||
      left.venue.name.localeCompare(right.venue.name) ||
      left.venue.slug.localeCompare(right.venue.slug)
    )
    .map(({ venue }) => venue);
  const selectedVenues: Venue[] = [];
  const selectedIds = new Set<string>();
  const addVenue = (venue: Venue | undefined) => {
    if (venue && selectedVenues.length < limit && !selectedIds.has(venue.id)) {
      selectedIds.add(venue.id);
      selectedVenues.push(venue);
    }
  };

  addVenue(venues.find((venue) => venue.slug === selectedVenueSlug));
  requiredVenueIds.forEach((venueId) => addVenue(venues.find((venue) => venue.id === venueId)));

  const activityTarget = Math.min(limit, Math.ceil(limit * 0.7));

  for (const venue of rankedVenues) {
    if (selectedVenues.length >= activityTarget) {
      break;
    }

    addVenue(venue);
  }

  const gridSize = Math.ceil(Math.sqrt(limit));
  const occupiedCells = new Set(selectedVenues.map((venue) => getMapGridCell(venue, region, gridSize)));

  for (const venue of rankedVenues) {
    if (selectedVenues.length >= limit) {
      break;
    }

    const cell = getMapGridCell(venue, region, gridSize);

    if (!occupiedCells.has(cell)) {
      occupiedCells.add(cell);
      addVenue(venue);
    }
  }

  for (const venue of rankedVenues) {
    if (selectedVenues.length >= limit) {
      break;
    }

    addVenue(venue);
  }

  return selectedVenues.sort((left, right) => left.slug.localeCompare(right.slug));
}

function getMapRecommendation(venues: Venue[], userLocation: UserLocation | null, now: Date) {
  return [...venues]
    .filter((venue) => venue.hasLiveCrowdSignal || getVenueOpenStatePriority(venue.openingHours, now) < 2)
    .sort((left, right) =>
      Number(right.hasLiveCrowdSignal) - Number(left.hasLiveCrowdSignal) ||
      getCrowdScore(right) - getCrowdScore(left) ||
      getVenueOpenStatePriority(left.openingHours, now) - getVenueOpenStatePriority(right.openingHours, now) ||
      getMapTrendWeight(right) - getMapTrendWeight(left) ||
      (right.ratingCount ?? 0) - (left.ratingCount ?? 0) ||
      (right.averageRating ?? 0) - (left.averageRating ?? 0) ||
      compareVenueDistance(left, right, userLocation) ||
      left.name.localeCompare(right.name)
    )[0] ?? null;
}

function getMapVenueLimit(region: MapRegion) {
  const span = Math.max(region.latitudeDelta, region.longitudeDelta);

  if (span >= 0.18) {
    return 8;
  }

  if (span >= 0.08) {
    return 12;
  }

  if (span >= 0.035) {
    return 18;
  }

  return MAX_MAP_VENUES;
}

function getMapGridCell(venue: Venue, region: MapRegion, gridSize: number) {
  const minimumLatitude = region.latitude - region.latitudeDelta / 2;
  const minimumLongitude = region.longitude - region.longitudeDelta / 2;
  const row = Math.max(0, Math.min(gridSize - 1, Math.floor(((venue.latitude - minimumLatitude) / region.latitudeDelta) * gridSize)));
  const column = Math.max(0, Math.min(gridSize - 1, Math.floor(((venue.longitude - minimumLongitude) / region.longitudeDelta) * gridSize)));
  return `${row}:${column}`;
}

function isVenueInMapRegion(venue: Venue, region: MapRegion) {
  const latitudeRadius = region.latitudeDelta * 0.5;
  const longitudeRadius = region.longitudeDelta * 0.5;
  return Math.abs(venue.latitude - region.latitude) <= latitudeRadius && Math.abs(venue.longitude - region.longitude) <= longitudeRadius;
}

function hasMapRegionChanged(committedRegion: MapRegion, pendingRegion: MapRegion) {
  const latitudeMovement = Math.abs(pendingRegion.latitude - committedRegion.latitude) / Math.max(committedRegion.latitudeDelta, 0.0001);
  const longitudeMovement = Math.abs(pendingRegion.longitude - committedRegion.longitude) / Math.max(committedRegion.longitudeDelta, 0.0001);
  const latitudeZoomChange = Math.abs(pendingRegion.latitudeDelta / Math.max(committedRegion.latitudeDelta, 0.0001) - 1);
  const longitudeZoomChange = Math.abs(pendingRegion.longitudeDelta / Math.max(committedRegion.longitudeDelta, 0.0001) - 1);
  return Math.max(latitudeMovement, longitudeMovement, latitudeZoomChange, longitudeZoomChange) >= 0.08;
}

function areMapRegionsEquivalent(left: MapRegion, right: MapRegion) {
  const latitudeDifference = Math.abs(left.latitude - right.latitude) / Math.max(right.latitudeDelta, 0.0001);
  const longitudeDifference = Math.abs(left.longitude - right.longitude) / Math.max(right.longitudeDelta, 0.0001);
  const latitudeDeltaDifference = Math.abs(left.latitudeDelta / Math.max(right.latitudeDelta, 0.0001) - 1);
  const longitudeDeltaDifference = Math.abs(left.longitudeDelta / Math.max(right.longitudeDelta, 0.0001) - 1);
  return Math.max(latitudeDifference, longitudeDifference, latitudeDeltaDifference, longitudeDeltaDifference) < 0.05;
}

function getMapTrendWeight(venue: Venue) {
  if (venue.trendingRank !== undefined) {
    return 3;
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

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getSearchTokens(value: string) {
  return value.split(" ").filter(Boolean);
}

function isSearchTokenMatch(queryToken: string, searchableToken: string) {
  if (searchableToken.includes(queryToken)) {
    return true;
  }

  if (queryToken.length < 4 || searchableToken.length < 4) {
    return false;
  }

  return getBoundedEditDistance(queryToken, searchableToken, 1) <= 1;
}

function getBoundedEditDistance(left: string, right: string, maxDistance: number) {
  if (Math.abs(left.length - right.length) > maxDistance) {
    return maxDistance + 1;
  }

  let previousRow = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const currentRow = [leftIndex];
    let rowBest = currentRow[0];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const distance = Math.min(
        previousRow[rightIndex] + 1,
        currentRow[rightIndex - 1] + 1,
        previousRow[rightIndex - 1] + substitutionCost
      );

      currentRow[rightIndex] = distance;
      rowBest = Math.min(rowBest, distance);
    }

    if (rowBest > maxDistance) {
      return maxDistance + 1;
    }

    previousRow = currentRow;
  }

  return previousRow[right.length];
}

const styles = StyleSheet.create({
  buttonDisabled: {
    opacity: 0.48
  },
  bottomPanel: {
    backgroundColor: colors.surfaceGlass,
    borderColor: "rgba(240, 171, 252, 0.28)",
    borderRadius: 28,
    borderWidth: 1,
    bottom: 18,
    left: 16,
    padding: 18,
    position: "absolute",
    right: 16
  },
  chip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    justifyContent: "center",
    minHeight: 44,
    paddingVertical: 9
  },
  chipDisabled: {
    opacity: 0.45
  },
  chipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  chipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700"
  },
  chipTextSelected: {
    color: colors.background
  },
  container: {
    backgroundColor: colors.background,
    flex: 1
  },
  emptyText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18
  },
  filterDropdown: {
    marginTop: 10
  },
  filterDropdownAction: {
    color: colors.amber,
    fontSize: 11,
    fontWeight: "900",
    marginLeft: 12,
    textTransform: "uppercase"
  },
  filterDropdownButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  filterDropdownButtonActive: {
    borderColor: colors.accent
  },
  filterDropdownCopy: {
    flex: 1
  },
  filterDropdownLabel: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  filterDropdownMenu: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 6,
    overflow: "hidden",
    padding: 12
  },
  filterDropdownSummary: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3
  },
  filterGroupLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 8,
    textTransform: "uppercase"
  },
  filterMenuHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -8
  },
  filterResetButton: {
    justifyContent: "center",
    minHeight: 44,
    paddingLeft: 16
  },
  filterResetText: {
    color: colors.amber,
    fontSize: 11,
    fontWeight: "900"
  },
  helperText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12
  },
  legendButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12
  },
  legendButtonText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "900"
  },
  legendItem: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800"
  },
  legendRow: {
    flexDirection: "row",
    gap: 12,
    paddingRight: 20
  },
  legendScroller: {
    marginTop: 10
  },
  compactMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4
  },
  inlineMusicActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12
  },
  inlineMusicButton: {
    alignItems: "center",
    borderRadius: 999,
    flex: 1,
    paddingVertical: 11
  },
  inlineMusicKicker: {
    color: colors.amber,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.3,
    textTransform: "uppercase"
  },
  inlineMusicPrimary: {
    backgroundColor: colors.accent
  },
  inlineMusicPrimaryText: {
    color: colors.background,
    fontSize: 13,
    fontWeight: "800"
  },
  inlineMusicPrompt: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 14,
    padding: 14
  },
  inlineMusicSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1
  },
  inlineMusicSecondaryText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800"
  },
  inlineMusicText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6
  },
  inlineMusicTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 5
  },
  kicker: {
    color: colors.amber,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.8,
    textTransform: "uppercase"
  },
  manualPromptButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    justifyContent: "center",
    minHeight: 44,
    paddingVertical: 10
  },
  manualPromptButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800"
  },
  manualPromptCopy: {
    flex: 1,
    paddingRight: 12
  },
  manualPromptLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800"
  },
  manualPromptRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14
  },
  manualPromptText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4
  },
  manualSummaryRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14
  },
  mapFilterChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    justifyContent: "center",
    minHeight: 44,
    paddingVertical: 8
  },
  mapFilterChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  mapFilterText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800"
  },
  mapFilterTextActive: {
    color: colors.background
  },
  mapFilters: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 20
  },
  mapFilterScrollerCompact: {
    marginHorizontal: -12,
    marginTop: 5,
    paddingHorizontal: 12
  },
  mapInsightButton: {
    flex: 1,
    justifyContent: "center",
    minHeight: 44
  },
  mapInsightLabel: {
    color: colors.amber,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  mapInsightRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginTop: 8
  },
  mapInsightText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 3
  },
  map: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background
  },
  mapUnavailable: {
    alignItems: "center",
    backgroundColor: colors.background,
    justifyContent: "center",
    padding: 24
  },
  mapUnavailableText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 280,
    textAlign: "center"
  },
  resultCount: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  reportMissingButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    justifyContent: "center",
    minHeight: 44,
    paddingVertical: 8
  },
  panelScrollContent: {
    paddingBottom: 2
  },
  reportMissingText: {
    color: colors.amber,
    fontSize: 12,
    fontWeight: "800"
  },
  searchBox: {
    marginTop: 12
  },
  searchAreaButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.accent,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 18
  },
  searchAreaButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900"
  },
  searchAreaContainer: {
    alignItems: "center",
    left: 0,
    position: "absolute",
    right: 0
  },
  searchExpanded: {
    marginTop: 12
  },
  searchInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  searchMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10
  },
  searchToggle: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    justifyContent: "center",
    minHeight: 44,
    paddingVertical: 9
  },
  searchToggleActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  searchToggleText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800"
  },
  searchToggleTextActive: {
    color: colors.background
  },
  searchResultActivity: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800"
  },
  searchResultCopy: {
    flex: 1,
    paddingRight: 10
  },
  searchResultMeta: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3
  },
  searchResultName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800"
  },
  searchResultRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 52,
    padding: 10
  },
  searchResults: {
    gap: 6,
    marginTop: 8
  },
  selectedVenueAction: {
    alignItems: "center",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 44,
    paddingVertical: 12
  },
  selectedVenueActionDisabled: {
    opacity: 0.45
  },
  selectedVenueActionText: {
    color: colors.background,
    fontSize: 13,
    fontWeight: "800"
  },
  selectedVenueActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14
  },
  selectedVenueCard: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    marginTop: 14,
    padding: 14
  },
  selectedVenueCloseButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12
  },
  selectedVenueCloseButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800"
  },
  selectedVenueCopy: {
    flex: 1,
    paddingRight: 12
  },
  selectedVenueHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  selectedVenueMeta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5
  },
  selectedVenueDiscoveryText: {
    color: colors.amber,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 8
  },
  selectedVenueLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  selectedVenueName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginTop: 6
  },
  selectedVenueNowPlaying: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 8
  },
  selectedVenueRatingText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 8
  },
  selectedVenueSoundText: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 6
  },
  selectedVenuePill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 10,
    paddingHorizontal: 9,
    paddingVertical: 6
  },
  selectedVenuePillText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800"
  },
  selectedVenuePlaceAction: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderWidth: 1,
    marginTop: 8
  },
  selectedVenuePrimaryAction: {
    flex: 1.25
  },
  selectedVenueSecondaryAction: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderWidth: 1,
    flex: 0.75
  },
  selectedVenueSecondaryActionText: {
    color: colors.text
  },
  selectedVenueVibe: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
    marginTop: 4
  },
  selectedVenueTrendingText: {
    color: colors.amber,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 6
  },
  selectedVenueVibeCard: {
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 12,
    padding: 12
  },
  selectedVenueVibeLabel: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  statusDenied: {
    backgroundColor: colors.warning
  },
  statusDot: {
    borderRadius: 5,
    height: 10,
    width: 10
  },
  statusGranted: {
    backgroundColor: colors.success
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  statusText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700"
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -1.2,
    marginTop: 6
  },
  topPanel: {
    backgroundColor: colors.surfaceGlass,
    borderColor: "rgba(240, 171, 252, 0.28)",
    borderRadius: 24,
    borderWidth: 1,
    left: 16,
    padding: 14,
    position: "absolute",
    right: 16
  },
  topHeaderActions: {
    flexDirection: "row",
    gap: 8
  },
  topHeaderCopy: {
    flex: 1,
    paddingRight: 12
  },
  topHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  venueChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10
  },
  warningText: {
    color: colors.amber,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10
  }
});
