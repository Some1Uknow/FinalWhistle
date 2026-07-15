import assert from "node:assert/strict";
import test from "node:test";
import { countryCodeForName } from "../src/components/country-flag";

test("country names resolve to bundled SVG flag codes", () => {
  assert.equal(countryCodeForName("New Zealand"), "nz");
  assert.equal(countryCodeForName("India"), "in");
  assert.equal(countryCodeForName("England U21"), "gb-eng");
  assert.equal(countryCodeForName("Manchester City"), undefined);
});
