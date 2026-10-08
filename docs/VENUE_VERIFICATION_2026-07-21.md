# Venue Verification Snapshot

Checked: 2026-08-01

## Automated Source Audit

- `npm run audit:venues:osm` matches 112 of 117 active seed rows to exact reviewed OpenStreetMap object IDs.
- The OSM match verifies source identity and opening metadata only. It does not verify operating status, capacity, vibe, or usual sound.
- Bubbla, COTÒ Helsinki, Set's Backyard, Night Garden, and DND are the five active manual-source venues without exact OSM matches.
- Tavastia uses current OSM node `1371747508` at `60.1685036, 24.9329693`.

## Official Review

| Venue | Decision | Evidence |
| --- | --- | --- |
| Bubbla | Verified open at Vilhonkatu 6; nightclub/lounge; Fri-Sat 22:00-04:30 | https://bubblahelsinki.fi/ and https://www.myhelsinki.fi/places/bubbla/ |
| COTÒ Helsinki | Verified open at Uudenmaankatu 3; courtyard terrace and nightclub; Wed-Sat 22:00-04:00; official whole-venue capacity up to 500 | https://www.cotohelsinki.fi/ and https://www.myhelsinki.fi/places/coto/ |
| Deliberi | Verified open at Keskuskatu 7 in the WTC building; operator hours Mon-Thu 10:30-24:00, Fri 10:30-02:00, Sat 11:00-02:00, and Sun 12:00-23:00; exact OSM node `5170957221` | https://deliberi.fi/ravintolat/deliberi-keskuskatu/, https://deliberi.fi/yhteys/#keskuskatu, and https://www.openstreetmap.org/node/5170957221 |
| DND | Verified current summer club at Allas Pool, Katajanokanlaituri 2 A; Fri-Sat 22:00-04:00 | https://luma.com/user/donotdiveclub, https://luma.com/14rw863l, and https://www.allaspool.fi/en/inner-yard/ |
| Night Garden | Verified current 2026 club events at Aleksin Piha, Aleksanterinkatu 15; covered courtyard, disco, and karaoke spaces; host capacity 500 | https://kide.app/community/d3cc627e-8c28-4fab-91a0-9aa0b67b0cfe, https://somo.social/en/e/night-garden-summer-bloom-pe-710, and https://venuu.fi/tilat/aleksin-piha |
| Pien Shop & Bar | Verified open at Ateneuminkuja 2; official hours stored in the seed | https://pien.fi/en/ and https://www.myhelsinki.fi/places/pien-shop-bar/ |
| Set's Backyard | Verified current seasonal courtyard nightclub at Bryggeri, Sofiankatu 2; Fri-Sat 22:00-04:00; host venue capacity 200 | https://api.cluby.com/web/public/venue/setsbackyard/front and https://venuu.fi/tilat/helsinki-bryggeri-brewhouse |
| DTM | Closed after June 2025 bankruptcy | https://yle.fi/a/74-20167541 and https://www.hs.fi/helsinki/art-2000011297784.html |
| Remix Nightclub | Closed/stale; the seed address is now Wolt's current business address | https://explore.wolt.com/en/fin/contact and https://ra.co/clubs/111232 |
| Merikerho | Closed after the operating company entered bankruptcy in February 2023 | https://www.hs.fi/helsinki/art-2000009420856.html |
| Heidi's Bier Bar Helsinki | Closed; the official Helsinki account reports closure and recent local reporting documents the May 2025 closure | https://www.instagram.com/heidisbierbarhelsinki/ and https://www.helsinginuutiset.fi/paikalliset/8514351 |

Cellar at Iso Roobertinkatu 10 is a separate current venue candidate and must not replace the historical Remix row without an independent seed review.

Set's Backyard and DND are seasonal pop-ups whose locations and schedules require review after summer 2026. Set's current Cluby coordinates still point near its former Lapinlahdenkatu location, so the seed uses the verified Bryggeri host coordinates from OSM node `2371493857`. DND's 500-person seed capacity is a conservative launch estimate within Allas's documented configurable courtyard range of 200-2,000, not an operator-published DND limit.

Night Garden's dated July events verify its current location and format but not a stable weekly schedule, so its opening hours remain unknown rather than extrapolating from individual event times.

Priority club sound tags were reviewed against current official calendars for Kaiku, Post Bar, Aaniwalli, Kuudes Linja, Maxine, Apollo Live Club, Kaarle XII, Hercules, Siltanen, Tiivistamo, and Club Stadion. Tags describe recurring programming, not a guarantee for every night.

## Ongoing Review

- Prioritize official-source checks for the most visited provisional venues.
- Treat event and holiday opening schedules as changeable.
- Process wrong address, hours, closure, duplicate, crowd, and music reports through `docs/VENUE_REPORT_REVIEW_RUNBOOK.md`.
