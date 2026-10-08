import { venueOsmMetadata as generatedVenueOsmMetadata } from "./venueOsmMetadata.generated";
import { VenueOpeningHours, VenueSoundTag } from "../types/venue";

export type VenueOsmMetadata = {
  openingHours: VenueOpeningHours;
  sourceCheckedAt: string;
  sourceExternalId: `${"node" | "relation" | "way"}/${number}`;
};

export type VenueOsmMetadataMap = Record<string, VenueOsmMetadata>;

export const venueOsmMetadata: VenueOsmMetadataMap = generatedVenueOsmMetadata;

const reviewedVenueMetadata: Record<string, Partial<VenueOsmMetadata> & Pick<VenueOsmMetadata, "openingHours" | "sourceCheckedAt">> = {
  "bubbla-helsinki": {
    openingHours: {
      checkedAt: "2026-07-21",
      expression: "Fr-Sa 22:00-04:30",
      source: "manual",
      weekly: {
        fri: [{ endMinute: 1440, startMinute: 1320 }],
        sat: [{ endMinute: 270, startMinute: 0 }, { endMinute: 1440, startMinute: 1320 }],
        sun: [{ endMinute: 270, startMinute: 0 }]
      }
    },
    sourceCheckedAt: "2026-07-21"
  },
  "coto-helsinki": {
    openingHours: {
      checkedAt: "2026-07-26",
      expression: "We-Sa 22:00-04:00",
      source: "manual",
      weekly: {
        fri: [{ endMinute: 240, startMinute: 0 }, { endMinute: 1440, startMinute: 1320 }],
        sat: [{ endMinute: 240, startMinute: 0 }, { endMinute: 1440, startMinute: 1320 }],
        sun: [{ endMinute: 240, startMinute: 0 }],
        thu: [{ endMinute: 240, startMinute: 0 }, { endMinute: 1440, startMinute: 1320 }],
        wed: [{ endMinute: 1440, startMinute: 1320 }]
      }
    },
    sourceCheckedAt: "2026-07-26"
  },
  "deliberi-keskuskatu": {
    openingHours: {
      checkedAt: "2026-08-01",
      expression: "Mo-Th 10:30-24:00; Fr 10:30-02:00; Sa 11:00-02:00; Su 12:00-23:00",
      source: "manual",
      weekly: {
        fri: [{ endMinute: 1440, startMinute: 630 }],
        mon: [{ endMinute: 1440, startMinute: 630 }],
        sat: [{ endMinute: 120, startMinute: 0 }, { endMinute: 1440, startMinute: 660 }],
        sun: [{ endMinute: 120, startMinute: 0 }, { endMinute: 1380, startMinute: 720 }],
        thu: [{ endMinute: 1440, startMinute: 630 }],
        tue: [{ endMinute: 1440, startMinute: 630 }],
        wed: [{ endMinute: 1440, startMinute: 630 }]
      }
    },
    sourceCheckedAt: "2026-08-01"
  },
  dnd: {
    openingHours: {
      checkedAt: "2026-07-28",
      expression: "Fr-Sa 22:00-04:00",
      source: "manual",
      weekly: {
        fri: [{ endMinute: 1440, startMinute: 1320 }],
        sat: [{ endMinute: 240, startMinute: 0 }, { endMinute: 1440, startMinute: 1320 }],
        sun: [{ endMinute: 240, startMinute: 0 }]
      }
    },
    sourceCheckedAt: "2026-07-28"
  },
  "night-garden": {
    openingHours: {
      checkedAt: "2026-07-28",
      source: "manual"
    },
    sourceCheckedAt: "2026-07-28"
  },
  "pien-shop-bar": {
    openingHours: {
      checkedAt: "2026-07-21",
      expression: "Tu 16:00-22:00; We-Th 14:00-24:00; Fr 12:00-01:00; Sa 12:00-24:00",
      source: "manual",
      weekly: {
        fri: [{ endMinute: 1440, startMinute: 720 }],
        sat: [{ endMinute: 60, startMinute: 0 }, { endMinute: 1440, startMinute: 720 }],
        thu: [{ endMinute: 1440, startMinute: 840 }],
        tue: [{ endMinute: 1320, startMinute: 960 }],
        wed: [{ endMinute: 1440, startMinute: 840 }]
      }
    },
    sourceCheckedAt: "2026-07-21"
  },
  "sets-backyard": {
    openingHours: {
      checkedAt: "2026-07-26",
      expression: "Fr-Sa 22:00-04:00",
      source: "manual",
      weekly: {
        fri: [{ endMinute: 1440, startMinute: 1320 }],
        sat: [{ endMinute: 240, startMinute: 0 }, { endMinute: 1440, startMinute: 1320 }],
        sun: [{ endMinute: 240, startMinute: 0 }]
      }
    },
    sourceCheckedAt: "2026-07-26"
  }
};

export const venueSourceMetadata = Object.fromEntries(
  Object.keys({ ...venueOsmMetadata, ...reviewedVenueMetadata }).map((slug) => [slug, {
    ...venueOsmMetadata[slug],
    ...reviewedVenueMetadata[slug],
    openingHours: reviewedVenueMetadata[slug]?.openingHours ?? venueOsmMetadata[slug]?.openingHours
  }])
) as Record<string, Partial<VenueOsmMetadata> & Pick<VenueOsmMetadata, "openingHours" | "sourceCheckedAt">>;

export const reviewedVenueSoundTags: Record<string, VenueSoundTag[]> = {
  kaiku: ["electronic"],
  "post-bar": ["electronic"],
  aaniwalli: ["electronic", "rock", "live-music", "mixed"],
  "kuudes-linja": ["electronic", "rock", "live-music", "mixed"],
  maxine: ["dance-pop", "karaoke", "mixed"],
  "apollo-live-club": ["live-music", "karaoke", "mixed"],
  "kaarle-xii": ["mixed"],
  hercules: ["dance-pop"],
  siltanen: ["electronic", "live-music", "karaoke", "mixed"],
  tiivistamo: ["mixed"],
  "club-stadion": ["live-music", "mixed"],
  "coto-helsinki": ["mixed"],
  dnd: ["unknown"],
  "night-garden": ["karaoke", "mixed"],
  "sets-backyard": ["mixed"]
};

export const venueMetadataAttribution = {
  label: "OpenStreetMap contributors",
  license: "Open Data Commons Open Database License (ODbL)",
  licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
  url: "https://www.openstreetmap.org/copyright"
} as const;
