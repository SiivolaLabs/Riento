export type VenueKind = "bar" | "club";

export type CrowdLevel = "quiet" | "active" | "busy" | "packed";

export type CrowdTrend = "cooling" | "rising" | "steady";

export type VenueDataSource = "manual" | "openstreetmap" | "google_places" | "foursquare";

export type VenueVerificationStatus = "needs_verification" | "verified" | "closed" | "duplicate";

export type VenueSoundTag = "dance-pop" | "electronic" | "jazz" | "karaoke" | "live-music" | "mixed" | "rock" | "unknown";

export type VenueOpenState = "closed" | "open" | "unknown";

export type VenueWeekday = "fri" | "mon" | "sat" | "sun" | "thu" | "tue" | "wed";

export type VenueOpeningInterval = {
  endMinute: number;
  startMinute: number;
};

export type VenueWeeklyOpeningHours = Partial<Record<VenueWeekday, VenueOpeningInterval[]>>;

export type VenueOpeningHours = {
  checkedAt: string;
  expression?: string;
  source: Extract<VenueDataSource, "manual" | "openstreetmap">;
  weekly?: VenueWeeklyOpeningHours;
};

export type VenueNowPlayingSource = "manual" | "user_audio_match" | "user_confirmation" | "venue_spotify";

export type VenueNowPlaying = {
  artistName?: string;
  title: string;
};

export type VenueMusicHistoryItem = {
  artistName?: string;
  title: string;
};

export type VenueMusicGenre = {
  name: string;
};

export type VenueMusicHistoryPeriod = {
  genres: VenueMusicGenre[];
  tracks: VenueMusicHistoryItem[];
};

export type VenueMusicHistory = {
  daily: VenueMusicHistoryPeriod;
  monthly: VenueMusicHistoryPeriod;
};

export type VenueRating = {
  comment?: string;
  id: string;
  isOwn: boolean;
  moderationStatus?: "approved" | "pending" | "rejected";
  rating: number;
  updatedAt: string;
  venueId: string;
};

export type Venue = {
  address: string;
  averageRating?: number;
  capacityEstimate: number;
  crowdLevel: CrowdLevel;
  crowdTrend?: CrowdTrend;
  dataSource: VenueDataSource;
  hasLiveCrowdSignal: boolean;
  id: string;
  isRemote: boolean;
  kind: VenueKind;
  lastUpdated: string;
  latitude: number;
  longitude: number;
  mockActivityScore: number;
  name: string;
  neighborhood: string;
  nowPlaying?: VenueNowPlaying;
  openingHours?: VenueOpeningHours;
  openingHoursSummary?: string;
  ratingCount?: number;
  slug: string;
  soundTags: VenueSoundTag[];
  sourceCheckedAt?: string;
  sourceExternalId?: string;
  trendingHeadline?: string;
  trendingRank?: number;
  verificationStatus: VenueVerificationStatus;
  vibe: string;
};
