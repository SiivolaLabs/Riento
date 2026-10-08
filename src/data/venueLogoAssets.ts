import { type MapMarkerProps } from "react-native-maps";

import { type CrowdLevel } from "../types/venue";

type MarkerImage = NonNullable<MapMarkerProps["image"]>;

const venueLogoAssets: Record<string, MarkerImage> = {
  "aaniwalli": require("../../assets/venue-logos/aaniwalli.png"),
  "alcatraz-club": require("../../assets/venue-logos/alcatraz-club.png"),
  "american-bar": require("../../assets/venue-logos/american-bar.png"),
  "apollo-live-club": require("../../assets/venue-logos/apollo-live-club.png"),
  "ateljee-bar-hotel-torni": require("../../assets/venue-logos/ateljee-bar-hotel-torni.png"),
  "aussie-bar": require("../../assets/venue-logos/aussie-bar.png"),
  "b-side-bar": require("../../assets/venue-logos/b-side-bar.png"),
  "bar-ihku": require("../../assets/venue-logos/bar-ihku.png"),
  "bar-loose": require("../../assets/venue-logos/bar-loose.png"),
  "bar-loosister": require("../../assets/venue-logos/bar-loosister.png"),
  "bar-mate": require("../../assets/venue-logos/bar-mate.png"),
  "bardem": require("../../assets/venue-logos/bardem.png"),
  "base-bar": require("../../assets/venue-logos/base-bar.png"),
  "basbas-kulma": require("../../assets/venue-logos/basbas-kulma.png"),
  "bier-bier": require("../../assets/venue-logos/bier-bier.png"),
  "black-bird": require("../../assets/venue-logos/black-bird.png"),
  "black-door": require("../../assets/venue-logos/black-door.png"),
  "blanda": require("../../assets/venue-logos/blanda.png"),
  "blondies-sport-bar-food": require("../../assets/venue-logos/blondies-sport-bar-food.png"),
  "bole-arena-club": require("../../assets/venue-logos/bole-arena-club.png"),
  "boothill-rock-club": require("../../assets/venue-logos/boothill-rock-club.png"),
  "brewster-bar": require("../../assets/venue-logos/brewster-bar.png"),
  "bricco": require("../../assets/venue-logos/bricco.png"),
  "bubbla-helsinki": require("../../assets/venue-logos/bubbla-helsinki.png"),
  "chihuahua-julep": require("../../assets/venue-logos/chihuahua-julep.png"),
  "club-stadion": require("../../assets/venue-logos/club-stadion.png"),
  "coolhead-brew": require("../../assets/venue-logos/coolhead-brew.png"),
  "etko-brewery-shop-taproom": require("../../assets/venue-logos/etko-brewery-shop-taproom.png"),
  "g-livelab": require("../../assets/venue-logos/g-livelab.png"),
  "gate-a21": require("../../assets/venue-logos/gate-a21.png"),
  "grotesk": require("../../assets/venue-logos/grotesk.png"),
  "heidis-bier-bar-helsinki": require("../../assets/venue-logos/heidis-bier-bar-helsinki.png"),
  "hemingways-itakeskus": require("../../assets/venue-logos/hemingways-itakeskus.png"),
  "henrys-pub": require("../../assets/venue-logos/henrys-pub.png"),
  "holiday-bar": require("../../assets/venue-logos/holiday-bar.png"),
  "huutokonttorin-kanttiini": require("../../assets/venue-logos/huutokonttorin-kanttiini.png"),
  "jackie": require("../../assets/venue-logos/jackie.png"),
  "juttutupa": require("../../assets/venue-logos/juttutupa.png"),
  "kaiku": require("../../assets/venue-logos/kaiku.png"),
  "kaisla": require("../../assets/venue-logos/kaisla.png"),
  "kaarle-xii": require("../../assets/venue-logos/kaarle-xii.png"),
  "kaivopuiston-mattolaituri": require("../../assets/venue-logos/kaivopuiston-mattolaituri.png"),
  "kork-bar": require("../../assets/venue-logos/kork-bar.png"),
  "kuudes-linja": require("../../assets/venue-logos/kuudes-linja.png"),
  "kult": require("../../assets/venue-logos/kult.png"),
  "kulttuuritehdas-korjaamo": require("../../assets/venue-logos/kulttuuritehdas-korjaamo.png"),
  "kupoli": require("../../assets/venue-logos/kupoli.png"),
  "kustaa-vaasa": require("../../assets/venue-logos/kustaa-vaasa.png"),
  "lepakkomies": require("../../assets/venue-logos/lepakkomies.png"),
  "limbo": require("../../assets/venue-logos/limbo.png"),
  "malja": require("../../assets/venue-logos/malja.png"),
  "mascot-bar-live-stage": require("../../assets/venue-logos/mascot-bar-live-stage.png"),
  "maxine": require("../../assets/venue-logos/maxine.png"),
  "milliklubi-bar-disco": require("../../assets/venue-logos/milliklubi-bar-disco.png"),
  "minato": require("../../assets/venue-logos/minato.png"),
  "molly-malones": require("../../assets/venue-logos/molly-malones.png"),
  "mummotunneli": require("../../assets/venue-logos/mummotunneli.png"),
  "noname-bar-nightclub": require("../../assets/venue-logos/noname-bar-nightclub.png"),
  "on-the-rocks": require("../../assets/venue-logos/on-the-rocks.png"),
  "one-pint-pub": require("../../assets/venue-logos/one-pint-pub.png"),
  "pien-shop-bar": require("../../assets/venue-logos/pien-shop-bar.png"),
  "pikkulintu-ruttopuisto": require("../../assets/venue-logos/pikkulintu-ruttopuisto.png"),
  "post-bar": require("../../assets/venue-logos/post-bar.png"),
  "praha": require("../../assets/venue-logos/praha.png"),
  "pub-perakammari": require("../../assets/venue-logos/pub-perakammari.png"),
  "ravintola-oiva": require("../../assets/venue-logos/ravintola-oiva.png"),
  "rooftop-bar-humu": require("../../assets/venue-logos/rooftop-bar-humu.png"),
  "runar": require("../../assets/venue-logos/runar.png"),
  "rymy-eetu": require("../../assets/venue-logos/rymy-eetu.png"),
  "semifinal": require("../../assets/venue-logos/semifinal.png"),
  "siltanen": require("../../assets/venue-logos/siltanen.png"),
  "sivukirjasto": require("../../assets/venue-logos/sivukirjasto.png"),
  "stadin-panimobaari": require("../../assets/venue-logos/stadin-panimobaari.png"),
  "storyville": require("../../assets/venue-logos/storyville.png"),
  "tavastia": require("../../assets/venue-logos/tavastia.png"),
  "teerenpeli-helsinki": require("../../assets/venue-logos/teerenpeli-helsinki.png"),
  "the-old-irish-pub": require("../../assets/venue-logos/the-old-irish-pub.png"),
  "the-riff": require("../../assets/venue-logos/the-riff.png"),
  "tiivistamo": require("../../assets/venue-logos/tiivistamo.png"),
  "villi-waino": require("../../assets/venue-logos/villi-waino.png"),
  "wallis": require("../../assets/venue-logos/wallis.png"),
  "wanha-kettu": require("../../assets/venue-logos/wanha-kettu.png")
};

const crowdRingAssets: Record<CrowdLevel, MarkerImage> = {
  active: require("../../assets/venue-logos/crowd-active.png"),
  busy: require("../../assets/venue-logos/crowd-busy.png"),
  packed: require("../../assets/venue-logos/crowd-packed.png"),
  quiet: require("../../assets/venue-logos/crowd-quiet.png")
};

export function getVenueLogoAsset(slug: string) {
  return venueLogoAssets[slug];
}

export function getCrowdRingAsset(level: CrowdLevel) {
  return crowdRingAssets[level];
}
