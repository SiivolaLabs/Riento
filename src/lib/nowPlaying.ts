import { Venue, VenueNowPlayingSource } from "../types/venue";

export function getNowPlayingText(nowPlaying: Venue["nowPlaying"]) {
  if (!nowPlaying) {
    return "No confirmed track yet.";
  }

  return nowPlaying.artistName ? `${nowPlaying.title} - ${nowPlaying.artistName}` : nowPlaying.title;
}

export function getNowPlayingSourceLabel(source: VenueNowPlayingSource) {
  switch (source) {
    case "venue_spotify":
      return "Venue Spotify";
    case "user_audio_match":
      return "Audio match";
    case "user_confirmation":
      return "Community confirmation";
    case "manual":
      return "Manual";
  }
}
