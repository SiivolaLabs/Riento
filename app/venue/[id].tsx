import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { Screen } from "../../src/components/Screen";
import { useAuth } from "../../src/context/AuthContext";
import { useProfileSettings } from "../../src/hooks/useProfileSettings";
import { useSavedVenueSlugs } from "../../src/hooks/useSavedVenueSlugs";
import { useVenues } from "../../src/hooks/useVenues";
import { getCrowdColor, getCrowdEmoji, getCrowdHint, getCrowdLabel, getCrowdTrendHint, getCrowdTrendLabel } from "../../src/lib/crowd";
import { getDistanceMeters } from "../../src/lib/geo";
import { hasConfiguredLegalPages, legalPages, openLegalPage } from "../../src/lib/legal";
import { openVenueDirections } from "../../src/lib/mapDirections";
import { getNowPlayingText } from "../../src/lib/nowPlaying";
import { formatVenueDistance, getVenueOpenStateLabel, getVenueSoundLabels, getVenueVibeColor } from "../../src/lib/venueDiscovery";
import { setAdminVenueNowPlaying, submitAdminVenueSignal } from "../../src/services/adminVenueService";
import { cancelForegroundMusicCheck, consumeLaunchMusicCheckIntent, requestForegroundMusicCheck, type MusicRecognitionTrackMatch } from "../../src/services/musicRecognitionService";
import { acceptReviewTerms, blockReviewAuthor, emptyVenueMusicHistory, getVenueMusicHistory, getVenueRatings, submitManualCheckin, submitMusicMatchFeedback, submitNowPlayingConfirmation, submitReviewReport, submitVenueRating, submitVenueReport, type ReviewReportReason, type VenueReportReason } from "../../src/services/venueService";
import { colors } from "../../src/theme/colors";
import { type CrowdLevel, type Venue, type VenueMusicHistory, type VenueMusicHistoryPeriod, type VenueRating } from "../../src/types/venue";

const REPORT_REASONS: { label: string; value: VenueReportReason }[] = [
  { label: "Wrong address", value: "wrong_address" },
  { label: "Wrong hours", value: "wrong_hours" },
  { label: "Closed", value: "closed" },
  { label: "Duplicate", value: "duplicate" },
  { label: "Crowd feels wrong", value: "wrong_crowd" },
  { label: "Music feels wrong", value: "wrong_music" },
  { label: "Other", value: "other" }
];

const REVIEW_REPORT_REASONS: { label: string; value: ReviewReportReason }[] = [
  { label: "Abusive", value: "abusive" },
  { label: "Harassment", value: "harassment" },
  { label: "Threat or danger", value: "safety_threat" },
  { label: "Personal info", value: "personal_information" },
  { label: "Spam", value: "spam" },
  { label: "False info", value: "false_information" },
  { label: "Other", value: "other" }
];

const ADMIN_ACTIVITY_LEVELS: CrowdLevel[] = ["quiet", "active", "busy", "packed"];

export default function VenueDetailScreen() {
  const { id, launchCheck } = useLocalSearchParams<{ id?: string; launchCheck?: string }>();
  const router = useRouter();
  const { ensureDeviceSession, isAdmin, isAnonymous, refreshAdminStatus, user } = useAuth();
  const { error: profileSettingsError, isLoading: profileSettingsLoading, settings } = useProfileSettings();
  const { savedVenueSlugs, setSaved } = useSavedVenueSlugs();
  const { error, isLoading, refresh, venues, warning } = useVenues();
  const [adminActivityLevel, setAdminActivityLevel] = useState<CrowdLevel | null>(null);
  const [adminActivityMessage, setAdminActivityMessage] = useState<string | null>(null);
  const [adminArtistName, setAdminArtistName] = useState("");
  const [adminMusicMessage, setAdminMusicMessage] = useState<string | null>(null);
  const [adminTrackTitle, setAdminTrackTitle] = useState("");
  const [detectedMusicMatch, setDetectedMusicMatch] = useState<MusicRecognitionTrackMatch | null>(null);
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);
  const [distanceMessage, setDistanceMessage] = useState<string | null>(null);
  const [isLoadingMusicHistory, setIsLoadingMusicHistory] = useState(false);
  const [isLoadingRatings, setIsLoadingRatings] = useState(false);
  const [isLocatingDistance, setIsLocatingDistance] = useState(false);
  const [isRequestingMusicCheck, setIsRequestingMusicCheck] = useState(false);
  const [isSubmittingAdminMusic, setIsSubmittingAdminMusic] = useState(false);
  const [isSubmittingMusicFeedback, setIsSubmittingMusicFeedback] = useState(false);
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const [isSubmittingNowPlaying, setIsSubmittingNowPlaying] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const [isTogglingSaved, setIsTogglingSaved] = useState(false);
  const [manualMessage, setManualMessage] = useState<string | null>(null);
  const [legalMessage, setLegalMessage] = useState<string | null>(null);
  const [nowPlayingMessage, setNowPlayingMessage] = useState<string | null>(null);
  const [musicHistory, setMusicHistory] = useState<VenueMusicHistory>(emptyVenueMusicHistory);
  const [reportDetails, setReportDetails] = useState("");
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<VenueReportReason>("wrong_address");
  const [ratingMessage, setRatingMessage] = useState<string | null>(null);
  const [reviewTermsAccepted, setReviewTermsAccepted] = useState(false);
  const [reviewText, setReviewText] = useState("");
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [ratings, setRatings] = useState<VenueRating[]>([]);
  const [musicFeedbackComplete, setMusicFeedbackComplete] = useState(false);
  const isScreenActive = useRef(true);
  const launchMusicCheckStarted = useRef(false);

  const venue = venues.find((candidate) => candidate.id === id || candidate.slug === id) ?? null;
  const canWriteReview = Boolean(user && !isAnonymous);
  const isSavedVenue = venue ? savedVenueSlugs.has(venue.slug) : false;

  function applyRatings(nextRatings: VenueRating[]) {
    setRatings(nextRatings);
    const ownRating = nextRatings.find((rating) => rating.isOwn);

    if (ownRating) {
      setSelectedRating(ownRating.rating);
      setReviewText(ownRating.comment ?? "");
    } else {
      setSelectedRating(null);
      setReviewText("");
    }
  }

  useFocusEffect(
    useCallback(() => {
      void refreshAdminStatus();
    }, [refreshAdminStatus])
  );

  useEffect(() => {
    isScreenActive.current = true;

    return () => {
      isScreenActive.current = false;
      cancelForegroundMusicCheck().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    setDistanceMeters(null);
    setDistanceMessage(null);
    setAdminActivityMessage(null);
    setAdminArtistName("");
    setAdminMusicMessage(null);
    setAdminTrackTitle("");
    setDetectedMusicMatch(null);
    setLegalMessage(null);
    setManualMessage(null);
    setNowPlayingMessage(null);
    setMusicFeedbackComplete(false);
    setRatingMessage(null);
    setRatings([]);
    setReportMessage(null);
    setReviewTermsAccepted(false);
    setReviewText("");
    setSelectedRating(null);
    launchMusicCheckStarted.current = false;
  }, [user?.id, venue?.slug]);

  useEffect(() => {
    if (!venue?.isRemote || !launchCheck || launchMusicCheckStarted.current) {
      return;
    }

    if (!consumeLaunchMusicCheckIntent(venue.id, launchCheck)) {
      return;
    }

    launchMusicCheckStarted.current = true;
    void handleMusicCheckStart();
  }, [launchCheck, venue?.id]);

  useEffect(() => {
    let active = true;

    if (!venue?.isRemote) {
      setMusicHistory(emptyVenueMusicHistory);
      setIsLoadingMusicHistory(false);
      return;
    }

    setIsLoadingMusicHistory(true);
    getVenueMusicHistory(venue.id)
      .then((nextHistory) => {
        if (active) {
          setMusicHistory(nextHistory);
          setIsLoadingMusicHistory(false);
        }
      })
      .catch((historyError: unknown) => {
        if (active) {
          setMusicHistory(emptyVenueMusicHistory);
          setNowPlayingMessage(historyError instanceof Error ? historyError.message : "Could not load music history.");
          setIsLoadingMusicHistory(false);
        }
      });

    return () => {
      active = false;
    };
  }, [venue?.id, venue?.isRemote]);

  useEffect(() => {
    let active = true;

    if (!venue?.isRemote) {
      setRatings([]);
      setIsLoadingRatings(false);
      return;
    }

    setIsLoadingRatings(true);
    getVenueRatings(venue.id)
      .then((nextRatings) => {
        if (active) {
          applyRatings(nextRatings);
          setIsLoadingRatings(false);
        }
      })
      .catch((ratingsError: unknown) => {
        if (active) {
          setRatings([]);
          setRatingMessage(ratingsError instanceof Error ? ratingsError.message : "Could not load ratings.");
          setIsLoadingRatings(false);
        }
      });

    return () => {
      active = false;
    };
  }, [user?.id, venue?.id, venue?.isRemote]);

  async function handleManualPlacement() {
    if (!venue) {
      return;
    }

    setManualMessage(null);

    if (profileSettingsLoading || profileSettingsError || !settings.manualPlacementEnabled) {
      setManualMessage(profileSettingsLoading || profileSettingsError
        ? "Manual placement is paused because its saved preference is unavailable."
        : "Manual placement is paused in Settings.");
      return;
    }

    if (!venue.isRemote) {
      setManualMessage("Manual placement needs Supabase venue rows before it can be sent.");
      return;
    }

    try {
      setIsSubmittingManual(true);
      const deviceSession = await ensureDeviceSession();

      if (!deviceSession.ok) {
        setManualMessage(deviceSession.message);
        return;
      }

      const result = await submitManualCheckin(venue.id);
      setManualMessage(result.message);

    } finally {
      setIsSubmittingManual(false);
    }
  }

  async function handleReportSubmit() {
    if (!venue) {
      return;
    }

    setReportMessage(null);

    if (!venue.isRemote) {
      setReportMessage("Reports need Supabase venue rows. This local seed cannot be reported yet.");
      return;
    }

    try {
      setIsSubmittingReport(true);
      const deviceSession = await ensureDeviceSession();

      if (!deviceSession.ok) {
        setReportMessage(deviceSession.message);
        return;
      }

      const result = await submitVenueReport(venue.id, reportReason, reportDetails);
      setReportMessage(result.message);

      if (result.ok) {
        setReportDetails("");
      }
    } finally {
      setIsSubmittingReport(false);
    }
  }

  async function handleRatingSubmit() {
    if (!venue) {
      return;
    }

    setRatingMessage(null);

    if (selectedRating === null) {
      setRatingMessage("Choose a rating from 1 to 5.");
      return;
    }

    if (!venue.isRemote) {
      setRatingMessage("Live ratings are temporarily unavailable for this venue.");
      return;
    }

    try {
      setIsSubmittingRating(true);
      const deviceSession = await ensureDeviceSession();

      if (!deviceSession.ok) {
        setRatingMessage(deviceSession.message);
        return;
      }

      const normalizedReviewText = reviewText.trim();

      if (normalizedReviewText.length > 0 && !canWriteReview) {
        setRatingMessage("Create or sign in to an optional review account before adding written text.");
        return;
      }

      if (normalizedReviewText.length > 0 && normalizedReviewText.length < 10) {
        setRatingMessage("Written reviews must be at least 10 characters.");
        return;
      }

      if (normalizedReviewText.length > 0 && !hasConfiguredLegalPages()) {
        setRatingMessage("Written reviews are unavailable until the Terms and Community Guidelines are configured. Number-only ratings still work.");
        return;
      }

      if (normalizedReviewText.length > 0 && !reviewTermsAccepted) {
        setRatingMessage("Accept the current Terms and Community Guidelines before adding written text.");
        return;
      }

      if (normalizedReviewText.length > 0) {
        const termsResult = await acceptReviewTerms();

        if (!termsResult.ok) {
          setRatingMessage(termsResult.message);
          return;
        }
      }

      const result = await submitVenueRating(venue.id, selectedRating, normalizedReviewText);
      setRatingMessage(result.ok && isAnonymous && normalizedReviewText.length === 0
        ? "Rating saved as private account-free feedback."
        : result.message);

      if (result.ok) {
        applyRatings(await getVenueRatings(venue.id));
        await refresh({ force: true });
      }
    } finally {
      setIsSubmittingRating(false);
    }
  }

  async function handleToggleSaved() {
    if (!venue) {
      return;
    }

    setRatingMessage(null);

    try {
      setIsTogglingSaved(true);
      const result = await setSaved(venue.slug, !isSavedVenue);
      setRatingMessage(result.message);
    } finally {
      setIsTogglingSaved(false);
    }
  }

  async function handleNowPlayingSubmit() {
    if (!venue) {
      return;
    }

    setNowPlayingMessage(null);

    if (!venue.isRemote) {
      setNowPlayingMessage("Now-playing confirmations need Supabase venue rows before they can be sent.");
      return;
    }

    if (!venue.nowPlaying) {
      setNowPlayingMessage("Identify the current song before sharing a new now-playing signal.");
      return;
    }

    try {
      setIsSubmittingNowPlaying(true);
      const deviceSession = await ensureDeviceSession();

      if (!deviceSession.ok) {
        setNowPlayingMessage(deviceSession.message);
        return;
      }

      const result = await submitNowPlayingConfirmation(venue.id, venue.nowPlaying.title, venue.nowPlaying.artistName ?? "", "user_confirmation");
      setNowPlayingMessage(result.message);
    } finally {
      setIsSubmittingNowPlaying(false);
    }
  }

  async function handleMusicCheckStart() {
    if (!venue) {
      return;
    }

    setNowPlayingMessage(null);
    setDetectedMusicMatch(null);
    setMusicFeedbackComplete(false);

    if (!venue.isRemote) {
      setNowPlayingMessage("Music checks need Supabase venue rows before they can be attached to a venue.");
      return;
    }

    try {
      setIsRequestingMusicCheck(true);
      const deviceSession = await ensureDeviceSession();

      if (!deviceSession.ok) {
        setNowPlayingMessage(deviceSession.message);
        return;
      }

      if (!isScreenActive.current) {
        return;
      }

      const result = await requestForegroundMusicCheck({ venueId: venue.id, venueName: venue.name });

      if (!isScreenActive.current) {
        return;
      }

      if (result.status === "matched" && result.match) {
        setDetectedMusicMatch(result.match);
        setMusicFeedbackComplete(false);
        setNowPlayingMessage(result.message);

        if (result.published) {
          await refresh({ force: true });
          setMusicHistory(await getVenueMusicHistory(venue.id));
        }
      } else {
        setNowPlayingMessage(result.message);
      }
    } catch (error) {
      setNowPlayingMessage(error instanceof Error ? error.message : "Could not start the foreground music check.");
    } finally {
      setIsRequestingMusicCheck(false);
    }
  }

  async function handleMusicCheckCancel() {
    const result = await cancelForegroundMusicCheck();
    setNowPlayingMessage(result.message);
  }

  async function handleDetectedMusicFeedback(isCorrect: boolean) {
    if (!venue || !detectedMusicMatch) {
      return;
    }

    setIsSubmittingMusicFeedback(true);
    setNowPlayingMessage(null);

    try {
      const deviceSession = await ensureDeviceSession();

      if (!deviceSession.ok) {
        setNowPlayingMessage(deviceSession.message);
        return;
      }

      const result = await submitMusicMatchFeedback(
        venue.id,
        detectedMusicMatch.title,
        detectedMusicMatch.artistName ?? "",
        isCorrect
      );
      setNowPlayingMessage(result.message);

      if (result.ok) {
        setMusicFeedbackComplete(true);
      }
    } finally {
      setIsSubmittingMusicFeedback(false);
    }
  }

  async function handleShowDistance() {
    if (!venue) {
      return;
    }

    setIsLocatingDistance(true);
    setDistanceMessage(null);

    try {
      let permission = await Location.getForegroundPermissionsAsync();

      if (permission.status !== Location.PermissionStatus.GRANTED) {
        permission = await Location.requestForegroundPermissionsAsync();
      }

      if (permission.status !== Location.PermissionStatus.GRANTED) {
        setDistanceMessage("Location permission is needed to show distance. No activity signal was sent.");
        return;
      }

      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setDistanceMeters(getDistanceMeters({ latitude: location.coords.latitude, longitude: location.coords.longitude }, venue));
      setDistanceMessage("Calculated on this device. No activity signal was sent.");
    } catch {
      setDistanceMessage("Could not calculate distance. No activity signal was sent.");
    } finally {
      setIsLocatingDistance(false);
    }
  }

  async function handleOpenDirections() {
    if (!venue) {
      return;
    }

    const result = await openVenueDirections(venue);

    if (!result.ok) {
      setDistanceMessage(result.message);
    }
  }

  async function handleAdminActivity(crowdLevel: CrowdLevel) {
    if (!venue?.isRemote) {
      setAdminActivityMessage("Activity management needs live Supabase venue data.");
      return;
    }

    setAdminActivityLevel(crowdLevel);
    setAdminActivityMessage(null);

    try {
      const result = await submitAdminVenueSignal(venue.id, crowdLevel);
      setAdminActivityMessage(result.ok
        ? `${getCrowdLabel(crowdLevel)} estimate published for 90 minutes.`
        : result.message);

      if (result.ok) {
        await refresh({ force: true });
      }
    } catch (adminError) {
      setAdminActivityMessage(adminError instanceof Error ? adminError.message : "Activity could not be updated.");
    } finally {
      setAdminActivityLevel(null);
    }
  }

  function handleAdminMusicSubmit() {
    if (!venue?.isRemote) {
      setAdminMusicMessage("Now-playing management needs live Supabase venue data.");
      return;
    }

    const trackTitle = adminTrackTitle.trim();
    const artistName = adminArtistName.trim();

    if (!trackTitle) {
      setAdminMusicMessage("Enter a track title.");
      return;
    }

    Alert.alert(
      "Publish trusted now playing?",
      `${venue.name}\n${trackTitle}${artistName ? ` - ${artistName}` : ""}\n\nThis will be treated as a trusted entry for 45 minutes.`,
      [
        { style: "cancel", text: "Cancel" },
        { text: "Publish", onPress: () => void publishAdminMusic(trackTitle, artistName) }
      ]
    );
  }

  async function publishAdminMusic(trackTitle: string, artistName: string) {
    if (!venue) {
      return;
    }

    setIsSubmittingAdminMusic(true);
    setAdminMusicMessage(null);

    try {
      const result = await setAdminVenueNowPlaying(venue.id, trackTitle, artistName);
      setAdminMusicMessage(result.message);

      if (result.ok) {
        setAdminTrackTitle("");
        setAdminArtistName("");
        await refresh({ force: true });
        setMusicHistory(await getVenueMusicHistory(venue.id));
      }
    } catch (adminError) {
      setAdminMusicMessage(adminError instanceof Error ? adminError.message : "Now playing could not be updated.");
    } finally {
      setIsSubmittingAdminMusic(false);
    }
  }

  async function handleOpenReviewLegal(page: typeof legalPages.terms | typeof legalPages.communityGuidelines) {
    setLegalMessage(null);
    const result = await openLegalPage(page);
    setLegalMessage(result.message);
  }

  async function runReviewAction(action: () => Promise<{ message: string; ok: boolean }>) {
    const deviceSession = await ensureDeviceSession();

    if (!deviceSession.ok) {
      setRatingMessage(deviceSession.message);
      return;
    }

    const result = await action();
    setRatingMessage(result.message);

    if (result.ok && venue?.isRemote) {
      setRatings(await getVenueRatings(venue.id));
    }
  }

  function handleReportReview(reviewId: string, reason: ReviewReportReason) {
    runReviewAction(() => submitReviewReport(reviewId, reason));
  }

  function handleBlockReviewer(reviewId: string) {
    Alert.alert("Block this reviewer?", "Their written reviews will be hidden from this account or private device session.", [
      { style: "cancel", text: "Cancel" },
      { style: "destructive", text: "Block", onPress: () => runReviewAction(() => blockReviewAuthor(reviewId)) }
    ]);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Pressable accessibilityLabel="Back" accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>

        {isLoading && !venue ? (
          <Text style={styles.statusText}>Loading venue...</Text>
        ) : venue ? (
          <>
            {(error || warning) && <Text accessibilityLiveRegion="polite" style={styles.warningText}>{error ?? warning}</Text>}
            <VenueDetailContent
            adminActivityLevel={adminActivityLevel}
            adminActivityMessage={adminActivityMessage}
            adminArtistName={adminArtistName}
            adminMusicMessage={adminMusicMessage}
            adminTrackTitle={adminTrackTitle}
            canSubmitManualPlacement={!profileSettingsLoading && !profileSettingsError && settings.manualPlacementEnabled}
            canWriteReview={canWriteReview}
            detectedMusicMatch={detectedMusicMatch}
            distanceMeters={distanceMeters}
            distanceMessage={distanceMessage}
            isSavedVenue={isSavedVenue}
            isAdmin={isAdmin}
            isLoadingMusicHistory={isLoadingMusicHistory}
            isLoadingRatings={isLoadingRatings}
            isLocatingDistance={isLocatingDistance}
            isRequestingMusicCheck={isRequestingMusicCheck}
            isSubmittingAdminMusic={isSubmittingAdminMusic}
            isSubmittingManual={isSubmittingManual}
            isSubmittingMusicFeedback={isSubmittingMusicFeedback}
            isSubmittingNowPlaying={isSubmittingNowPlaying}
            isSubmittingReport={isSubmittingReport}
            isSubmittingRating={isSubmittingRating}
            isTogglingSaved={isTogglingSaved}
            manualMessage={manualMessage}
            legalMessage={legalMessage}
            musicHistory={musicHistory}
            musicFeedbackComplete={musicFeedbackComplete}
            nowPlayingMessage={nowPlayingMessage}
            onManualPlacement={handleManualPlacement}
            onAdminActivity={handleAdminActivity}
            onAdminArtistNameChange={setAdminArtistName}
            onAdminMusicSubmit={handleAdminMusicSubmit}
            onAdminTrackTitleChange={setAdminTrackTitle}
            onOpenDirections={handleOpenDirections}
            onShowDistance={handleShowDistance}
            onOpenReviewLegal={handleOpenReviewLegal}
            onMusicCheckCancel={handleMusicCheckCancel}
            onMusicCheckStart={handleMusicCheckStart}
            onMusicFeedback={handleDetectedMusicFeedback}
            onNowPlayingSubmit={handleNowPlayingSubmit}
            onReportDetailsChange={setReportDetails}
            onReportReasonChange={setReportReason}
            onReportSubmit={handleReportSubmit}
            onRatingChange={setSelectedRating}
            onReviewTextChange={setReviewText}
            onReviewTermsAcceptedChange={setReviewTermsAccepted}
            onOpenReviewAccount={() => router.push({ pathname: "/(tabs)/profile" })}
            onReportReview={handleReportReview}
            onBlockReviewer={handleBlockReviewer}
            onRatingSubmit={handleRatingSubmit}
            onToggleSaved={handleToggleSaved}
            ratingMessage={ratingMessage}
            ratings={ratings}
            reportDetails={reportDetails}
            reportMessage={reportMessage}
            reportReason={reportReason}
            reviewTermsAccepted={reviewTermsAccepted}
            reviewText={reviewText}
            selectedRating={selectedRating}
            venue={venue}
            />
          </>
        ) : error ? (
          <Text style={styles.warningText}>{error}</Text>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Venue not found</Text>
            <Text style={styles.cardText}>The venue may have been removed, filtered out, or not loaded from Supabase yet.</Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

type VenueDetailContentProps = {
  adminActivityLevel: CrowdLevel | null;
  adminActivityMessage: string | null;
  adminArtistName: string;
  adminMusicMessage: string | null;
  adminTrackTitle: string;
  canSubmitManualPlacement: boolean;
  canWriteReview: boolean;
  detectedMusicMatch: MusicRecognitionTrackMatch | null;
  distanceMeters: number | null;
  distanceMessage: string | null;
  isSavedVenue: boolean;
  isAdmin: boolean;
  isLoadingMusicHistory: boolean;
  isLoadingRatings: boolean;
  isLocatingDistance: boolean;
  isRequestingMusicCheck: boolean;
  isSubmittingAdminMusic: boolean;
  isSubmittingManual: boolean;
  isSubmittingMusicFeedback: boolean;
  isSubmittingNowPlaying: boolean;
  isSubmittingRating: boolean;
  isSubmittingReport: boolean;
  isTogglingSaved: boolean;
  manualMessage: string | null;
  legalMessage: string | null;
  musicHistory: VenueMusicHistory;
  musicFeedbackComplete: boolean;
  nowPlayingMessage: string | null;
  onAdminActivity: (crowdLevel: CrowdLevel) => void;
  onAdminArtistNameChange: (value: string) => void;
  onAdminMusicSubmit: () => void;
  onAdminTrackTitleChange: (value: string) => void;
  onManualPlacement: () => void;
  onOpenDirections: () => void;
  onShowDistance: () => void;
  onOpenReviewLegal: (page: typeof legalPages.terms | typeof legalPages.communityGuidelines) => void;
  onMusicCheckCancel: () => void;
  onMusicCheckStart: () => void;
  onMusicFeedback: (isCorrect: boolean) => void;
  onNowPlayingSubmit: () => void;
  onRatingChange: (value: number) => void;
  onRatingSubmit: () => void;
  onReviewTextChange: (value: string) => void;
  onReviewTermsAcceptedChange: (value: boolean) => void;
  onOpenReviewAccount: () => void;
  onReportReview: (reviewId: string, reason: ReviewReportReason) => void;
  onBlockReviewer: (reviewId: string) => void;
  onReportDetailsChange: (value: string) => void;
  onReportReasonChange: (value: VenueReportReason) => void;
  onReportSubmit: () => void;
  onToggleSaved: () => void;
  ratingMessage: string | null;
  ratings: VenueRating[];
  reportDetails: string;
  reportMessage: string | null;
  reportReason: VenueReportReason;
  reviewTermsAccepted: boolean;
  reviewText: string;
  selectedRating: number | null;
  venue: Venue;
};

function VenueDetailContent({
  adminActivityLevel,
  adminActivityMessage,
  adminArtistName,
  adminMusicMessage,
  adminTrackTitle,
  canSubmitManualPlacement,
  canWriteReview,
  detectedMusicMatch,
  distanceMeters,
  distanceMessage,
  isSavedVenue,
  isAdmin,
  isLoadingMusicHistory,
  isLoadingRatings,
  isLocatingDistance,
  isRequestingMusicCheck,
  isSubmittingAdminMusic,
  isSubmittingManual,
  isSubmittingMusicFeedback,
  isSubmittingNowPlaying,
  isSubmittingRating,
  isSubmittingReport,
  isTogglingSaved,
  manualMessage,
  legalMessage,
  musicHistory,
  musicFeedbackComplete,
  nowPlayingMessage,
  onAdminActivity,
  onAdminArtistNameChange,
  onAdminMusicSubmit,
  onAdminTrackTitleChange,
  onManualPlacement,
  onOpenDirections,
  onShowDistance,
  onOpenReviewLegal,
  onMusicCheckCancel,
  onMusicCheckStart,
  onMusicFeedback,
  onNowPlayingSubmit,
  onRatingChange,
  onRatingSubmit,
  onReviewTextChange,
  onReviewTermsAcceptedChange,
  onOpenReviewAccount,
  onReportReview,
  onBlockReviewer,
  onReportDetailsChange,
  onReportReasonChange,
  onReportSubmit,
  onToggleSaved,
  ratingMessage,
  ratings,
  reportDetails,
  reportMessage,
  reportReason,
  reviewTermsAccepted,
  reviewText,
  selectedRating,
  venue
}: VenueDetailContentProps) {
  const crowdColor = getCrowdColor(venue.crowdLevel, venue.hasLiveCrowdSignal);

  return (
    <>
      <Text style={styles.kicker}>{venue.neighborhood}</Text>
      <Text style={styles.title}>{venue.name}</Text>
      <Text style={styles.subtitle}>{venue.address}</Text>

      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View>
            <Text style={styles.cardLabel}>Current signal</Text>
            <Text style={styles.heroSignal}>{getCrowdEmoji(venue.crowdLevel, venue.hasLiveCrowdSignal)} {getCrowdLabel(venue.crowdLevel, venue.hasLiveCrowdSignal)}</Text>
          </View>
          <View style={[styles.signalPill, { borderColor: crowdColor }]}>
            <View style={[styles.signalDot, { backgroundColor: crowdColor }]} />
            <Text style={styles.signalPillText}>{venue.kind}</Text>
          </View>
        </View>
        <Text style={styles.cardText}>{getCrowdHint(venue.crowdLevel, venue.hasLiveCrowdSignal)}. Exact crowd counts stay hidden for privacy.</Text>
        {venue.crowdTrend && <Text style={styles.trendText}>Trend: {getCrowdTrendLabel(venue.crowdTrend)}. {getCrowdTrendHint(venue.crowdTrend)}.</Text>}
        <Text style={styles.metaText}>{venue.hasLiveCrowdSignal ? "Based on current venue activity" : "Waiting for venue activity"}</Text>
      </View>

      {isAdmin && (
        <View style={styles.adminCard}>
          <Text style={styles.cardTitle}>Manage activity</Text>
          <Text style={styles.cardText}>Publish a temporary venue estimate for 90 minutes. Current device signals may keep the displayed activity higher.</Text>
          <View style={styles.adminSignalRow}>
            {ADMIN_ACTIVITY_LEVELS.map((crowdLevel) => {
              const signalColor = getCrowdColor(crowdLevel, true);
              const isBusy = adminActivityLevel === crowdLevel;

              return (
                <Pressable
                  accessibilityLabel={`Set temporary activity estimate for ${venue.name} to ${getCrowdLabel(crowdLevel)}`}
                  accessibilityRole="button"
                  accessibilityState={{ busy: isBusy, disabled: adminActivityLevel !== null || !venue.isRemote }}
                  disabled={adminActivityLevel !== null || !venue.isRemote}
                  key={crowdLevel}
                  onPress={() => onAdminActivity(crowdLevel)}
                  style={[styles.adminSignalChip, { borderColor: signalColor }, (adminActivityLevel !== null || !venue.isRemote) && styles.buttonDisabled]}
                >
                  <Text style={[styles.adminSignalText, { color: signalColor }]}>{isBusy ? "Saving..." : `${getCrowdEmoji(crowdLevel)} ${getCrowdLabel(crowdLevel)}`}</Text>
                </Pressable>
              );
            })}
          </View>
          {!venue.isRemote && <Text style={styles.messageText}>Activity management needs live Supabase venue data.</Text>}
          {adminActivityMessage && <Text accessibilityLiveRegion="polite" style={styles.messageText}>{adminActivityMessage}</Text>}
          <View style={styles.adminMusicSection}>
            <Text style={styles.cardTitle}>Manage now playing</Text>
            <Text style={styles.cardText}>Enter a song you have verified at this venue. It is treated as trusted and shown for 45 minutes.</Text>
            <TextInput
              accessibilityLabel="Trusted track title"
              maxLength={200}
              onChangeText={onAdminTrackTitleChange}
              placeholder="Track title"
              placeholderTextColor={colors.muted}
              style={styles.adminMusicInput}
              value={adminTrackTitle}
            />
            <TextInput
              accessibilityLabel="Trusted artist name"
              maxLength={200}
              onChangeText={onAdminArtistNameChange}
              placeholder="Artist (optional)"
              placeholderTextColor={colors.muted}
              style={styles.adminMusicInput}
              value={adminArtistName}
            />
            <Pressable accessibilityRole="button" accessibilityState={{ busy: isSubmittingAdminMusic, disabled: isSubmittingAdminMusic || !venue.isRemote }} disabled={isSubmittingAdminMusic || !venue.isRemote} onPress={onAdminMusicSubmit} style={[styles.secondaryButton, (isSubmittingAdminMusic || !venue.isRemote) && styles.buttonDisabled]}>
              <Text style={styles.secondaryButtonText}>{isSubmittingAdminMusic ? "Publishing..." : "Publish trusted song"}</Text>
            </Pressable>
            {adminMusicMessage && <Text accessibilityLiveRegion="polite" style={styles.messageText}>{adminMusicMessage}</Text>}
          </View>
        </View>
      )}

      <View style={styles.decisionCard}>
        <View style={styles.decisionHeader}>
          <View style={styles.decisionCopy}>
            <Text style={styles.cardLabel}>Plan the night</Text>
            <Text style={styles.decisionOpenState}>{getVenueOpenStateLabel(venue.openingHours)}</Text>
          </View>
        </View>
        <View style={styles.decisionActions}>
          <Pressable accessibilityLabel={`Open walking directions to ${venue.name}`} accessibilityRole="button" onPress={onOpenDirections} style={[styles.compactButton, styles.directionsButton]}>
            <Text style={[styles.compactButtonText, styles.directionsButtonText]}>Directions</Text>
          </Pressable>
          <Pressable accessibilityLabel={`Show distance to ${venue.name}`} accessibilityRole="button" accessibilityState={{ busy: isLocatingDistance }} disabled={isLocatingDistance} onPress={onShowDistance} style={[styles.compactButton, isLocatingDistance && styles.buttonDisabled]}>
            <Text style={styles.compactButtonText}>{isLocatingDistance ? "Finding..." : distanceMeters === null ? "Show distance" : formatVenueDistance(distanceMeters)}</Text>
          </Pressable>
        </View>
        <Text style={styles.decisionVibe}>{venue.vibe}</Text>
        <Text style={styles.decisionSound}>Usually: {getVenueSoundLabels(venue.soundTags).join(", ")}</Text>
        {distanceMessage && <Text accessibilityLiveRegion="polite" style={styles.messageText}>{distanceMessage}</Text>}
        <Text style={styles.cardText}>Hours can change, especially for events and holidays.</Text>
      </View>

      <View style={styles.quickActionRow}>
        <Pressable accessibilityLabel={isSavedVenue ? "Remove from My spots" : "Save to My spots"} accessibilityRole="button" accessibilityState={{ busy: isTogglingSaved, selected: isSavedVenue }} disabled={isTogglingSaved} onPress={onToggleSaved} style={[styles.saveButton, isSavedVenue && styles.saveButtonActive, isTogglingSaved && styles.buttonDisabled]}>
          <Text style={[styles.saveButtonText, isSavedVenue && styles.saveButtonTextActive]}>{isTogglingSaved ? "Saving..." : isSavedVenue ? "Saved to My spots" : "Save to My spots"}</Text>
        </Pressable>
        <View style={styles.ratingSummaryPill}>
          <Text style={styles.ratingSummaryText}>{formatVenueRating(venue)}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Now playing</Text>
        <Text style={styles.nowPlayingTrack}>{getNowPlayingText(venue.nowPlaying)}</Text>
        {venue.nowPlaying ? (
          <Text style={styles.cardText}>Recently verified by a trusted provider or authorized venue-data admin.</Text>
        ) : (
          <Text style={styles.cardText}>No trusted song is active for this venue yet.</Text>
        )}
        <Text style={styles.cardText}>If you can clearly hear the room, confirm the displayed track privately or identify it. Android provider matches publish from Riento's trusted server; iPhone ShazamKit matches stay on this device. Raw audio is not stored by Riento. Free-form song entry is available only to authorized admins.</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ busy: isRequestingMusicCheck }} disabled={isRequestingMusicCheck} onPress={onMusicCheckStart} style={[styles.secondaryButton, isRequestingMusicCheck && styles.buttonDisabled]}>
          <Text style={styles.secondaryButtonText}>{isRequestingMusicCheck ? "Identifying music..." : "Identify this song"}</Text>
        </Pressable>
        {isRequestingMusicCheck && (
          <Pressable accessibilityRole="button" onPress={onMusicCheckCancel} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Cancel music check</Text>
          </Pressable>
        )}
        {venue.nowPlaying && (
          <Pressable accessibilityRole="button" accessibilityState={{ busy: isSubmittingNowPlaying }} disabled={isSubmittingNowPlaying} onPress={onNowPlayingSubmit} style={[styles.secondaryButton, isSubmittingNowPlaying && styles.buttonDisabled]}>
            <Text style={styles.secondaryButtonText}>{isSubmittingNowPlaying ? "Saving..." : "Confirm privately"}</Text>
          </Pressable>
        )}
        {detectedMusicMatch && (
          <View style={styles.musicFeedbackCard}>
            <Text style={styles.cardLabel}>Accuracy check</Text>
            <Text style={styles.musicFeedbackLocation}>Location: {venue.name}</Text>
            <Text style={styles.musicFeedbackTrack}>Song: {detectedMusicMatch.title}{detectedMusicMatch.artistName ? ` - ${detectedMusicMatch.artistName}` : ""}</Text>
            {musicFeedbackComplete ? (
              <Text accessibilityLiveRegion="polite" style={styles.musicFeedbackThanks}>Thank you. Your feedback improves Riento's venue and music accuracy.</Text>
            ) : (
              <>
                <Text style={styles.cardText}>Are both the location and song right?</Text>
                <View style={styles.musicFeedbackActions}>
                  <Pressable accessibilityLabel="Location or song is not right" accessibilityRole="button" accessibilityState={{ disabled: isSubmittingMusicFeedback }} disabled={isSubmittingMusicFeedback} onPress={() => onMusicFeedback(false)} style={[styles.compactButton, isSubmittingMusicFeedback && styles.buttonDisabled]}>
                    <Text style={styles.compactButtonText}>No</Text>
                  </Pressable>
                  <Pressable accessibilityLabel="Location and song are right" accessibilityRole="button" accessibilityState={{ disabled: isSubmittingMusicFeedback }} disabled={isSubmittingMusicFeedback} onPress={() => onMusicFeedback(true)} style={[styles.compactButton, styles.musicFeedbackYes, isSubmittingMusicFeedback && styles.buttonDisabled]}>
                    <Text style={[styles.compactButtonText, styles.musicFeedbackYesText]}>{isSubmittingMusicFeedback ? "Saving..." : "Yes"}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        )}
        {nowPlayingMessage && <Text accessibilityLiveRegion="polite" style={styles.messageText}>{nowPlayingMessage}</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Music history</Text>
        <Text style={styles.cardText}>Recent trusted music matches can show what this venue usually sounds like, even when nothing fresh is playing right now.</Text>
        {isLoadingMusicHistory ? (
          <Text style={styles.messageText}>Loading music history...</Text>
        ) : (
          <View style={styles.musicHistoryGrid}>
            <MusicHistoryPeriodCard label="Last 24 hours" period={musicHistory.daily} />
            <MusicHistoryPeriodCard label="Last 30 days" period={musicHistory.monthly} />
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Ratings</Text>
        <Text style={styles.cardText}>Choose 1–5 without an account as private feedback. Public averages use at least three established account ratings. Optional account holders can add a written review, which is moderated before publication.</Text>
        <View style={styles.ratingPicker}>
          {[1, 2, 3, 4, 5].map((rating) => {
            const isActive = selectedRating === rating;

            return (
              <Pressable accessibilityLabel={`${rating} out of 5`} accessibilityRole="button" accessibilityState={{ selected: isActive }} key={rating} onPress={() => onRatingChange(rating)} style={[styles.ratingChip, isActive && styles.ratingChipActive]}>
                <Text style={[styles.ratingChipText, isActive && styles.ratingChipTextActive]}>{rating}/5</Text>
              </Pressable>
            );
          })}
        </View>
        {canWriteReview ? (
          <>
            <TextInput
              accessibilityLabel="Optional written venue review"
              maxLength={700}
              multiline
              onChangeText={onReviewTextChange}
              placeholder="Optional written review"
              placeholderTextColor={colors.muted}
              style={styles.reviewInput}
              textAlignVertical="top"
              value={reviewText}
            />
            <Text style={styles.reviewLengthText}>{reviewText.trim().length}/700 characters. Written reviews need at least 10.</Text>
            <View style={styles.reviewLegalLinks}>
              <Pressable accessibilityRole="link" onPress={() => onOpenReviewLegal(legalPages.terms)} style={styles.reviewLegalLink}><Text style={styles.reviewLegalLinkText}>Read Terms</Text></Pressable>
              <Pressable accessibilityRole="link" onPress={() => onOpenReviewLegal(legalPages.communityGuidelines)} style={styles.reviewLegalLink}><Text style={styles.reviewLegalLinkText}>Read Guidelines</Text></Pressable>
            </View>
            {legalMessage && <Text accessibilityLiveRegion="polite" style={styles.messageText}>{legalMessage}</Text>}
            {reviewText.trim().length > 0 && (
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: reviewTermsAccepted }} onPress={() => onReviewTermsAcceptedChange(!reviewTermsAccepted)} style={styles.reviewTermsRow}>
                <View style={[styles.reviewTermsCheck, reviewTermsAccepted && styles.reviewTermsCheckActive]}>
                  {reviewTermsAccepted && <Text style={styles.reviewTermsCheckText}>✓</Text>}
                </View>
                <Text style={styles.reviewTermsText}>I accept the current Terms and Community Guidelines shown in Settings.</Text>
              </Pressable>
            )}
          </>
        ) : (
          <Pressable accessibilityRole="button" onPress={onOpenReviewAccount} style={styles.accountReviewPrompt}>
            <Text style={styles.accountReviewPromptText}>Want to add text? Create or sign in to an optional review account in Settings.</Text>
          </Pressable>
        )}
        <Text style={styles.cardText}>Written reviews must be venue-specific and respectful. No harassment, hate, threats, personal information, impersonation, or spam. Report published text here or contact Siivola.Labs@proton.me for moderation support.</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ busy: isSubmittingRating, disabled: isSubmittingRating || selectedRating === null }} disabled={isSubmittingRating || selectedRating === null} onPress={onRatingSubmit} style={[styles.secondaryButton, (isSubmittingRating || selectedRating === null) && styles.buttonDisabled]}>
          <Text style={styles.secondaryButtonText}>{isSubmittingRating ? "Saving..." : "Save rating"}</Text>
        </Pressable>
        {ratingMessage && <Text accessibilityLiveRegion="polite" style={styles.messageText}>{ratingMessage}</Text>}
        {isLoadingRatings ? (
          <Text style={styles.messageText}>Loading ratings...</Text>
        ) : ratings.length > 0 ? (
          <View style={styles.reviewList}>
            {ratings.map((rating) => <RatingCard key={rating.id} onBlockReviewer={onBlockReviewer} onReportReview={onReportReview} rating={rating} />)}
          </View>
        ) : (
          <Text style={styles.cardText}>No public ratings yet.</Text>
        )}
      </View>

      <View style={styles.cardGrid}>
        <InfoCard label="Vibe" toneColor={getVenueVibeColor(venue)} value={venue.vibe} />
        <InfoCard label="Capacity" value={`Approx. ${venue.capacityEstimate}`} />
        <InfoCard label="Usual sound" value={getVenueSoundLabels(venue.soundTags).join(", ")} />
        {venue.crowdTrend && <InfoCard label="Trend" value={getCrowdTrendLabel(venue.crowdTrend)} />}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Opening hours</Text>
        <Text style={styles.cardText}>{getVenueOpenStateLabel(venue.openingHours)}. Hours can change, especially for events and holidays. Report anything that looks wrong below.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Place yourself here</Text>
        <Text style={styles.cardText}>Use this when GPS is unavailable or inaccurate. It updates only the venue-level crowd signal.</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ busy: isSubmittingManual, disabled: isSubmittingManual || !canSubmitManualPlacement }} disabled={isSubmittingManual || !canSubmitManualPlacement} onPress={onManualPlacement} style={[styles.primaryButton, (isSubmittingManual || !canSubmitManualPlacement) && styles.buttonDisabled]}>
          <Text style={styles.primaryButtonText}>{isSubmittingManual ? "Sharing..." : "Place me here"}</Text>
        </Pressable>
        {manualMessage && <Text accessibilityLiveRegion="polite" style={styles.messageText}>{manualMessage}</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Report venue data</Text>
        <Text style={styles.cardText}>Flag wrong data, closed venues, duplicates, or crowd labels that feel off. Reports are private review inputs.</Text>
        <View style={styles.reasonGrid}>
          {REPORT_REASONS.map((reason) => {
            const isActive = reportReason === reason.value;

            return (
              <Pressable accessibilityRole="button" accessibilityState={{ selected: isActive }} key={reason.value} onPress={() => onReportReasonChange(reason.value)} style={[styles.reasonChip, isActive && styles.reasonChipActive]}>
                <Text style={[styles.reasonChipText, isActive && styles.reasonChipTextActive]}>{reason.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          accessibilityLabel="Optional private venue report details"
          maxLength={1000}
          multiline
          onChangeText={onReportDetailsChange}
          placeholder="Optional details for private review"
          placeholderTextColor={colors.muted}
          style={styles.reportInput}
          textAlignVertical="top"
          value={reportDetails}
        />
        <Pressable accessibilityRole="button" accessibilityState={{ busy: isSubmittingReport }} disabled={isSubmittingReport} onPress={onReportSubmit} style={[styles.secondaryButton, isSubmittingReport && styles.buttonDisabled]}>
          <Text style={styles.secondaryButtonText}>{isSubmittingReport ? "Sending report..." : "Send report"}</Text>
        </Pressable>
        {reportMessage && <Text accessibilityLiveRegion="polite" style={styles.messageText}>{reportMessage}</Text>}
      </View>

      <View style={styles.trustCard}>
        <Text style={styles.cardTitle}>Privacy guardrail</Text>
        <Text style={styles.cardText}>Riento uses this venue page for aggregated venue signals only. Reports, GPS pings, and manual placements do not create public user dots.</Text>
      </View>
    </>
  );
}

type MusicHistoryPeriodCardProps = {
  label: string;
  period: VenueMusicHistoryPeriod;
};

function MusicHistoryPeriodCard({ label, period }: MusicHistoryPeriodCardProps) {
  const hasTracks = period.tracks.length > 0;
  const hasGenres = period.genres.length > 0;

  return (
    <View style={styles.musicHistoryCard}>
      <Text style={styles.cardLabel}>{label}</Text>
      {hasGenres ? (
        <Text style={styles.musicHistoryGenres}>Genres heard here: {period.genres.map((genre) => genre.name).join(", ")}</Text>
      ) : (
        <Text style={styles.cardText}>No genre pattern yet.</Text>
      )}
      {hasTracks ? (
        <View style={styles.musicHistoryTracks}>
          {period.tracks.map((track) => (
            <Text key={`${track.title}-${track.artistName ?? "unknown"}`} style={styles.musicHistoryTrackText}>
              {formatHistoryTrack(track.title, track.artistName)} / Recently heard
            </Text>
          ))}
        </View>
      ) : (
        <Text style={styles.cardText}>No tracks heard here yet.</Text>
      )}
    </View>
  );
}

type InfoCardProps = {
  label: string;
  toneColor?: string;
  value: string;
};

function InfoCard({ label, toneColor, value }: InfoCardProps) {
  return (
    <View style={[styles.infoCard, toneColor && { backgroundColor: `${toneColor}14`, borderColor: `${toneColor}66` }]}>
      <Text style={[styles.cardLabel, toneColor && { color: toneColor }]}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

type RatingCardProps = {
  onBlockReviewer: (reviewId: string) => void;
  onReportReview: (reviewId: string, reason: ReviewReportReason) => void;
  rating: VenueRating;
};

function RatingCard({ onBlockReviewer, onReportReview, rating }: RatingCardProps) {
  const [isChoosingReportReason, setIsChoosingReportReason] = useState(false);

  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHeader}>
        <Text style={styles.reviewRating}>{rating.rating}/5</Text>
        <Text style={styles.reviewDate}>{formatRatingTimestamp(rating.updatedAt)}</Text>
      </View>
      {rating.comment && <Text style={styles.reviewText}>{rating.comment}</Text>}
      {rating.isOwn && rating.moderationStatus === "pending" && <Text style={styles.reviewStatus}>Your rating and written review are saved. Public display waits for moderation.</Text>}
      {rating.isOwn && rating.moderationStatus === "rejected" && <Text style={styles.reviewStatus}>Your written text was not approved. The rating remains saved privately; edit or remove the text to resubmit.</Text>}
      {rating.comment && !rating.isOwn && (
        <View style={styles.reviewActions}>
          <Pressable accessibilityRole="button" onPress={() => setIsChoosingReportReason((value) => !value)} style={styles.reviewActionTarget}>
            <Text style={styles.reviewActionText}>Report</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => onBlockReviewer(rating.id)} style={styles.reviewActionTarget}>
            <Text style={styles.reviewActionText}>Block reviewer</Text>
          </Pressable>
        </View>
      )}
      {isChoosingReportReason && (
        <View style={styles.reviewReportReasons}>
          {REVIEW_REPORT_REASONS.map((reason) => (
            <Pressable
              accessibilityRole="button"
              key={reason.value}
              onPress={() => {
                setIsChoosingReportReason(false);
                onReportReview(rating.id, reason.value);
              }}
              style={styles.reviewReportReason}
            >
              <Text style={styles.reviewReportReasonText}>{reason.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function formatHistoryTrack(title: string, artistName?: string) {
  return artistName ? `${title} - ${artistName}` : title;
}

function formatRatingTimestamp(value: string) {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatVenueRating(venue: Venue) {
  if (!venue.averageRating || !venue.ratingCount) {
    return "No ratings yet";
  }

  return `${venue.averageRating.toFixed(1)}/5 from ${venue.ratingCount} ${venue.ratingCount === 1 ? "rating" : "ratings"}`;
}

const styles = StyleSheet.create({
  accountReviewPrompt: {
    backgroundColor: "rgba(139, 92, 246, 0.10)",
    borderColor: "rgba(139, 92, 246, 0.42)",
    borderRadius: 16,
    borderWidth: 1,
    padding: 13
  },
  accountReviewPromptText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    textAlign: "center"
  },
  adminCard: {
    backgroundColor: "rgba(245, 158, 11, 0.10)",
    borderColor: "rgba(245, 158, 11, 0.42)",
    borderRadius: 24,
    borderWidth: 1,
    gap: 12,
    marginTop: 16,
    padding: 18
  },
  adminMusicInput: {
    backgroundColor: "rgba(10, 13, 20, 0.72)",
    borderColor: "rgba(245, 158, 11, 0.38)",
    borderRadius: 14,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    minHeight: 46,
    paddingHorizontal: 13
  },
  adminMusicSection: {
    borderTopColor: "rgba(245, 158, 11, 0.28)",
    borderTopWidth: 1,
    gap: 10,
    marginTop: 4,
    paddingTop: 16
  },
  adminSignalChip: {
    backgroundColor: "rgba(245, 158, 11, 0.16)",
    borderColor: "rgba(245, 158, 11, 0.46)",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  adminSignalRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  adminSignalText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800"
  },
  backButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  backButtonText: {
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
    gap: 12,
    marginTop: 16,
    padding: 18
  },
  cardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 16
  },
  cardLabel: {
    color: colors.amber,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  cardText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21
  },
  cardTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800"
  },
  compactButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 14
  },
  compactButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900"
  },
  content: {
    paddingBottom: 34,
    paddingHorizontal: 20,
    paddingTop: 18
  },
  decisionCard: {
    backgroundColor: colors.surfaceElevated,
    borderColor: "rgba(34, 211, 238, 0.36)",
    borderRadius: 24,
    borderWidth: 1,
    gap: 8,
    marginTop: 16,
    padding: 18
  },
  decisionActions: {
    flexDirection: "row",
    gap: 10
  },
  decisionCopy: {
    flex: 1,
    paddingRight: 12
  },
  decisionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  decisionOpenState: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
    marginTop: 5
  },
  decisionSound: {
    color: colors.cyan,
    fontSize: 13,
    fontWeight: "800"
  },
  decisionVibe: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800"
  },
  directionsButton: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  directionsButtonText: {
    color: colors.background
  },
  guestPrompt: {
    gap: 12
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderColor: "rgba(240, 171, 252, 0.28)",
    borderRadius: 28,
    borderWidth: 1,
    gap: 14,
    marginTop: 24,
    padding: 20
  },
  heroHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  heroSignal: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.7,
    marginTop: 8
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    flexGrow: 1,
    flexBasis: "47%",
    gap: 8,
    padding: 16
  },
  infoValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 21,
    textTransform: "capitalize"
  },
  kicker: {
    color: colors.amber,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.8,
    marginTop: 22,
    textTransform: "uppercase"
  },
  messageText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19
  },
  musicFeedbackActions: {
    flexDirection: "row",
    gap: 10
  },
  musicFeedbackCard: {
    backgroundColor: "rgba(34, 211, 238, 0.08)",
    borderColor: "rgba(34, 211, 238, 0.34)",
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 14
  },
  musicFeedbackLocation: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800"
  },
  musicFeedbackThanks: {
    color: colors.cyan,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20
  },
  musicFeedbackTrack: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 23
  },
  musicFeedbackYes: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan
  },
  musicFeedbackYesText: {
    color: colors.background
  },
  metaText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  musicHistoryCard: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexBasis: "47%",
    flexGrow: 1,
    gap: 8,
    padding: 14
  },
  musicHistoryGenres: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19
  },
  musicHistoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  musicHistoryTrackText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18
  },
  musicHistoryTracks: {
    gap: 5
  },
  nowPlayingTrack: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
    lineHeight: 26
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 48,
    paddingVertical: 13
  },
  primaryButtonText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: "800"
  },
  reasonChip: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  reasonChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  reasonChipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800"
  },
  reasonChipTextActive: {
    color: colors.background
  },
  reasonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  reportInput: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    minHeight: 92,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingVertical: 13
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800"
  },
  signalDot: {
    borderRadius: 5,
    height: 10,
    width: 10
  },
  signalPill: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  signalPillText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "capitalize"
  },
  statusText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 24
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10
  },
  title: {
    color: colors.text,
    fontSize: 38,
    fontWeight: "800",
    letterSpacing: -1.2,
    lineHeight: 43,
    marginTop: 8
  },
  trustCard: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 10,
    marginTop: 16,
    padding: 18
  },
  trendText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19
  },
  warningText: {
    backgroundColor: "rgba(249, 115, 22, 0.12)",
    borderColor: "rgba(249, 115, 22, 0.34)",
    borderRadius: 16,
    borderWidth: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 24,
    padding: 12
  },
  quickActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14
  },
  ratingChip: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  ratingChipActive: {
    backgroundColor: colors.rose,
    borderColor: colors.rose
  },
  ratingChipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800"
  },
  ratingChipTextActive: {
    color: colors.background
  },
  ratingPicker: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  ratingSummaryPill: {
    alignItems: "center",
    backgroundColor: "rgba(251, 113, 133, 0.14)",
    borderColor: "rgba(251, 113, 133, 0.42)",
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 11
  },
  ratingSummaryText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center"
  },
  reviewCard: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 14
  },
  reviewActions: {
    flexDirection: "row",
    gap: 18,
    marginTop: 2
  },
  reviewActionTarget: {
    justifyContent: "center",
    minHeight: 44
  },
  reviewActionText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800"
  },
  reviewDate: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700"
  },
  reviewHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  reviewList: {
    gap: 10
  },
  reviewInput: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    minHeight: 112,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  reviewLegalLink: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12
  },
  reviewLegalLinks: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  reviewLegalLinkText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "900"
  },
  reviewLengthText: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16
  },
  reviewRating: {
    color: colors.rose,
    fontSize: 13,
    fontWeight: "900"
  },
  reviewReportReason: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  reviewReportReasonText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800"
  },
  reviewReportReasons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7
  },
  reviewStatus: {
    color: colors.amber,
    fontSize: 12,
    lineHeight: 18
  },
  reviewTermsCheck: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    width: 22
  },
  reviewTermsCheckActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  reviewTermsCheckText: {
    color: colors.background,
    fontSize: 13,
    fontWeight: "900"
  },
  reviewTermsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 44
  },
  reviewTermsText: {
    color: colors.muted,
    flex: 1,
    fontSize: 12,
    lineHeight: 18
  },
  reviewText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 20
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "rgba(34, 211, 238, 0.42)",
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 11
  },
  saveButtonActive: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan
  },
  saveButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center"
  },
  saveButtonTextActive: {
    color: colors.background
  }
});
