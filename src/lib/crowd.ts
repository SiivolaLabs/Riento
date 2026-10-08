import { CrowdLevel, CrowdTrend, Venue } from "../types/venue";

export function getCrowdScore(venue: Pick<Venue, "mockActivityScore">) {
  return Math.max(0, Math.min(1, venue.mockActivityScore));
}

export function getCrowdLevelScore(level: CrowdLevel) {
  switch (level) {
    case "packed":
      return 0.9;
    case "busy":
      return 0.65;
    case "active":
      return 0.35;
    case "quiet":
      return 0.1;
  }
}

export function getCrowdLevel(score: number): CrowdLevel {
  if (score >= 0.78) {
    return "packed";
  }

  if (score >= 0.55) {
    return "busy";
  }

  if (score >= 0.28) {
    return "active";
  }

  return "quiet";
}

export function getCrowdColor(level: CrowdLevel, hasLiveSignal = true) {
  if (!hasLiveSignal) {
    return "#64748B";
  }

  switch (level) {
    case "packed":
      return "#D946EF";
    case "busy":
      return "#F97316";
    case "active":
      return "#FACC15";
    case "quiet":
      return "#22C55E";
  }
}

export function getCrowdLabel(level: CrowdLevel, hasLiveSignal = true) {
  if (!hasLiveSignal) {
    return "No live signal";
  }

  switch (level) {
    case "packed":
      return "Packed";
    case "busy":
      return "Busy";
    case "active":
      return "Active";
    case "quiet":
      return "Quiet";
  }
}

export function getCrowdEmoji(level: CrowdLevel, hasLiveSignal = true) {
  if (!hasLiveSignal) {
    return "○";
  }

  switch (level) {
    case "packed":
      return "🟣";
    case "busy":
      return "🟠";
    case "active":
      return "🟡";
    case "quiet":
      return "🟢";
  }
}

export function getCrowdHint(level: CrowdLevel, hasLiveSignal = true) {
  if (!hasLiveSignal) {
    return "Waiting for a current device signal";
  }

  switch (level) {
    case "packed":
      return "Very strong signal";
    case "busy":
      return "Strong signal";
    case "active":
      return "Warming up";
    case "quiet":
      return "Low signal";
  }
}

export function getCrowdTrendLabel(trend: CrowdTrend) {
  switch (trend) {
    case "rising":
      return "Rising";
    case "steady":
      return "Steady";
    case "cooling":
      return "Cooling";
  }
}

export function getCrowdTrendHint(trend: CrowdTrend) {
  switch (trend) {
    case "rising":
      return "Activity is building";
    case "steady":
      return "Activity is holding steady";
    case "cooling":
      return "Activity is easing";
  }
}
