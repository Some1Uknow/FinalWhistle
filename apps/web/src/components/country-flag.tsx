import { countries } from "countries-list";

const flagAliases: Record<string, string> = {
  "bolivia": "bo",
  "brunei": "bn",
  "cape verde": "cv",
  "cote d ivoire": "ci",
  "czech republic": "cz",
  "england": "gb-eng",
  "ivory coast": "ci",
  "kosovo": "xk",
  "laos": "la",
  "moldova": "md",
  "northern ireland": "gb-nir",
  "north korea": "kp",
  "palestine": "ps",
  "republic of ireland": "ie",
  "russia": "ru",
  "scotland": "gb-sct",
  "south korea": "kr",
  "south sudan": "ss",
  "syria": "sy",
  "tanzania": "tz",
  "united states": "us",
  "united states of america": "us",
  "usa": "us",
  "venezuela": "ve",
  "wales": "gb-wls"
};

const countryCodes = new Map<string, string>();
for (const [code, country] of Object.entries(countries)) {
  countryCodes.set(normalizeCountryName(country.name), code.toLowerCase());
  countryCodes.set(normalizeCountryName(country.native), code.toLowerCase());
}

export function CountryFlag({ name, fallbackClassName }: { name: string; fallbackClassName: string }) {
  const code = countryCodeForName(name);
  if (code) {
    return <span className={`country-flag fi fi-${code}`} role="img" aria-label={`${name} flag`} />;
  }

  return <span className={`club-initial ${fallbackClassName}`} aria-hidden="true">{initial(name)}</span>;
}

export function countryCodeForName(name: string) {
  const normalized = normalizeCountryName(name);
  const direct = flagAliases[normalized] ?? countryCodes.get(normalized);
  if (direct) return direct;

  const withoutTeamSuffix = normalizeCountryName(
    name.replace(/\b(?:women|men|national team|u-?\d{1,3}|under\s+\d{1,3})\b/gi, " ")
  );
  return flagAliases[withoutTeamSuffix] ?? countryCodes.get(withoutTeamSuffix);
}

function normalizeCountryName(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function initial(value: string) {
  return value.trim().slice(0, 1).toUpperCase() || "?";
}
