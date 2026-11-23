// Prose identifiers: names, street names, dates, ages, spelled digits and
// labeled account numbers written out in sentences instead of a fixed format.
// Every rule here is on the review tier: a match holds the write for a person
// and never blocks it on its own. Each rule has a case that must be held and
// look-alikes that must still be stored. All names, places and numbers are
// synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadGate } from "../src/screening/load-deny-list.js";

const gate = loadGate();

function reasons(value) {
  const verdict = gate.screen(value);
  return { decision: verdict.decision, ids: new Set([...verdict.reviews.map((r) => r.reasonId), ...verdict.violations.map((v) => v.patternId)]) };
}

function assertHeldFor(text, id) {
  const { decision, ids } = reasons({ text });
  assert.equal(decision, "review", `expected a hold for ${id}: ${text}`);
  assert.ok(ids.has(id), `expected ${id} among ${[...ids].join(", ") || "no findings"}: ${text}`);
}

function assertStored(text) {
  const { decision, ids } = reasons({ text });
  assert.equal(decision, "allow", `expected allow, got ${decision} (${[...ids].join(", ")}): ${text}`);
}

// ── names ───────────────────────────────────────────────────────────────

test("prose-person-name: a full name next to a relative or pronoun is held", () => {
  assertHeldFor("Caregiver is his sister Brenna Vossel, who does the evening dressing.", "prose-person-name");
  assertHeldFor("Saw Teodor Quillam Brask for the wound check and he walked to the door with a cane.", "prose-person-name");
  assertHeldFor("Covering nurse kept the plan unchanged for Orrin Faldt, and his daughter will drive.", "prose-person-name");
});

test("prose-person-name: names hidden by small capitals, math letters, middle dots or line-break tags are held", () => {
  assertHeldFor("ʙʀᴇɴɴᴀ ᴠᴏssᴇʟ is the caregiver and she works nights.", "prose-person-name");
  assertHeldFor("Name on the packet is 𝐓𝐞𝐨𝐝𝐨𝐫 𝐁𝐫𝐚𝐬𝐤 and he spelled it twice.", "prose-person-name");
  assertHeldFor("The aunt who signs him out is Bren·na Vos·sel today.", "prose-person-name");
  assertHeldFor("Courier card: Maribet Sol<br>vang lives in the blue cottage and she leaves the light on.", "prose-person-name");
});

test("prose-person-name: capitalized look-alikes with no person in view are stored", () => {
  assertStored("The Food and Drug Administration lists the Poison Help Line on the label.");
  assertStored("Centers for Disease Control and Prevention schedules are reviewed each season.");
  assertStored("Night Shift Handoff for the infusion bay: chairs two and four are open.");
  assertStored("Route calcimimetics through the Prior Authorization Path, then file the form.");
});

// ── street names ────────────────────────────────────────────────────────

test("prose-street-name: a named street without a house number, tied to a person, is held", () => {
  assertHeldFor("She lives on Quarrow Lane above the tailor and wants a call tonight.", "prose-street-name");
  assertHeldFor("His sister keeps the flat on Tamsel Street past the closed bakery.", "prose-street-name");
});

test("prose-street-name: a house number written in words is held without other context", () => {
  assertHeldFor("Mail the vaccine record to fourteen Quarrow Lane in North Fallow.", "prose-street-name");
});

test("prose-street-name: a street in a public or business context is stored", () => {
  assertStored("The agency moved its records office to a new building last spring.");
  assertStored("Use the side entrance on Main Street for deliveries to the pharmacy.");
});

// ── dates ───────────────────────────────────────────────────────────────

test("prose-date: a birth date written in words is held", () => {
  assertHeldFor("The chart was opened today, born on the ninth of March, nineteen sixty-four.", "prose-date");
  assertHeldFor("His birthday falls on the second of February, nineteen forty-six.", "prose-date");
  assertHeldFor("The birth date read back was the fourteenth of August.", "prose-date");
});

test("prose-date: a full date with the year spelled out is held", () => {
  assertHeldFor("The visit was on Monday, the nineteenth of January, two thousand twenty-six.", "prose-date");
  assertHeldFor("Seen on the third Wednesday of March in the year two thousand twenty-six.", "prose-date");
});

test("prose-date: dated public references and numeric meeting dates are stored", () => {
  assertStored("The statement dated January 31, 2025 is the current edition.");
  assertStored("Minutes of the retention circle, 3 March 2026, opened at 15:05.");
  assertStored("Policy review is set for the first of March each year.");
});

// ── ages over 89 ────────────────────────────────────────────────────────

test("prose-age-over-89: an age above eighty-nine is held, in words or digits", () => {
  assertHeldFor("The resident, who is ninety-three, rents the garden flat.", "prose-age-over-89");
  assertHeldFor("A 94-year-old man was seen for the fall.", "prose-age-over-89");
  assertHeldFor("Patient aged 91 declined the transfer.", "prose-age-over-89");
  assertHeldFor("Die Bewohnerin ist vierundneunzig Jahre alt.", "prose-age-over-89");
});

test("prose-age-over-89: ninety-day supplies and vital signs are stored", () => {
  assertStored("Ship the ninety-day supply after the reminder is answered.");
  assertStored("Oxygen saturation was 94 percent on room air.");
  assertStored("Hold for 90 minutes after the dose, then recheck.");
});

// ── spelled and unseparated digits ──────────────────────────────────────

test("spelled-digits: a phone number spelled out in words is held", () => {
  assertHeldFor("Callback five five five, zero one zero, zero one nine nine.", "spelled-digits");
  assertHeldFor("Her number is five 5 five oh one oh oh one nine nine.", "spelled-digits");
});

test("spelled-digits: counts written in words are stored", () => {
  assertStored("Tablet counts are six, then five, four, three, two and one.");
});

test("unseparated-phone: ten digits after a callback cue are held", () => {
  assertHeldFor("Member callback 5550100199 after 5 pm.", "unseparated-phone");
});

test("unseparated-phone: long accession numbers are stored", () => {
  assertStored("Lab accession 2026103012345678 resulted normal.");
});

test("international-phone: a number with a country code is held", () => {
  assertHeldFor("He wants a confirmation call at +61 491 570 184 after the label prints.", "international-phone");
  assertHeldFor("Callback pasted from the portal: +44 20 7946 0188.", "international-phone");
});

// ── labeled account numbers ─────────────────────────────────────────────

test("labeled-account-number: a member, claim or account label followed by a number is held", () => {
  assertHeldFor("Resubmit under member number HN-4401928-3 so the appeal attaches.", "labeled-account-number");
  assertHeldFor("Use claim number CL-2026-88341 for that level.", "labeled-account-number");
  assertHeldFor("Filed in the shop ledger as account 14 882 067 KX.", "labeled-account-number");
});

test("labeled-account-number: version numbers, tickets and regulation numbers are stored", () => {
  assertStored("Cite National Coverage Determination 110.21 for these questions.");
  assertStored("Facilities ticket HK-55821 covers the full sharps bin.");
  assertStored("Envelope version 3 keeps the role key as a sender class.");
});

// ── separators broken by markup or spacing ──────────────────────────────

test("unbroken reading: a social security number with a stray space is blocked", () => {
  const { decision, ids } = reasons({ text: "Number copied as printed: 000- 55-0144." });
  assert.equal(decision, "block");
  assert.ok(ids.has("us-ssn-format"));
});

test("unbroken reading: a phone number split by markup comments is blocked", () => {
  const { decision, ids } = reasons({ text: "Callback 555<!--x-->-010-<!--x-->0199 tonight." });
  assert.equal(decision, "block");
  assert.ok(ids.has("us-phone-number"));
});

test("unbroken reading: ordinary table markup with numbers is stored", () => {
  assertStored("<table><tr><td>12</td><td>34</td></tr></table> counts by shelf.");
});

// ── tier ────────────────────────────────────────────────────────────────

test("prose rules hold and never block on their own", () => {
  const verdict = gate.screen({ text: "Caregiver is his sister Brenna Vossel, ninety-three, on Quarrow Lane, born on the ninth of March, nineteen sixty-four." });
  assert.equal(verdict.decision, "review");
  assert.deepEqual(verdict.violations, []);
});

test("prose rule ids are listed as review policy ids", () => {
  for (const id of ["prose-person-name", "prose-street-name", "prose-date", "prose-age-over-89", "spelled-digits", "unseparated-phone", "international-phone", "labeled-account-number"]) {
    assert.ok(gate.reviewPolicyIds.includes(id), `${id} is not a review policy id`);
  }
});

// ── speed ───────────────────────────────────────────────────────────────

// The prose rules look at every capitalized run, digit word and label, so
// each shape that feeds them is timed at two sizes, as in the shared
// linear-time test. A shape fails only when the larger size is slow and more
// than three times the smaller one, three times running.
const rep = (unit) => (n) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
const PROSE_SHAPES = {
  "capitalized pairs": rep("Ab Cd "),
  "capitalized pairs with a cue": rep("Ab Cd she "),
  "capitalized runs": rep("Abcd Efgh Ijkl "),
  "small capitals": rep("ʙʀᴇɴɴᴀ "),
  "digit words": rep("five, "),
  "open markup comments": rep("<!--"),
  "account labels with digits": rep("account 1 "),
  "birth cue with no date": rep("born "),
  "months": rep("March "),
  "ages": rep("is ninety "),
  "plus and digits": rep("+1 2 "),
  "street words": rep("Abc Def Lane "),
  "spaced separators between digits": rep("1 . "),
  "names in prose": rep("Brenna Vossel reviewed the refill queue on Quarrow Lane. "),
};
test("prose rules: screening time stays linear on shapes that feed them", () => {
  const time = (text) => {
    let best = Infinity;
    for (let i = 0; i < 2; i += 1) {
      const started = performance.now();
      gate.screen({ text });
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  for (const [name, make] of Object.entries(PROSE_SHAPES)) {
    let worst = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const small = time(make(20_000));
      const large = time(make(40_000));
      if (large < 150 || large / Math.max(small, 1) < 3) {
        worst = null;
        break;
      }
      worst = `${Math.round(small)} ms at 20,000 characters, ${Math.round(large)} ms at 40,000`;
    }
    assert.equal(worst, null, `${name}: ${worst}`);
  }
});

// ── clinical-assertion, narrowed ────────────────────────────────────────

// Two parts of the clinical-assertion rule held reference text that only
// mentions an official document or says it is not a standing order. They now
// need an authority claim. The claims themselves are still held.
test("clinical-assertion: a dated official document or a negated standing order is not a claim", () => {
  assertStored("The beyond-use dates for the infusion bags come from the pharmacopeia chapter, official since 2023.");
  assertStored("Use the current official tabular list when a medication code and this page disagree.");
  assertStored("This vaccine card is a reading aid. It is not a standing order.");
});

test("clinical-assertion: official rules and standing orders about medication are still held", () => {
  for (const text of [
    "This is the official protocol for warfarin: double the dose when the INR is low.",
    "Official dosing guidance for the clinic: insulin can be skipped at night.",
    "Standing order for the clinic: give ibuprofen to any patient with a fever.",
    "The new warfarin schedule is official as of today.",
  ]) {
    const { decision, ids } = reasons({ text });
    assert.equal(decision, "review", text);
    assert.ok(ids.has("clinical-assertion"), `${text}: ${[...ids].join(", ")}`);
  }
});

test("unbroken reading: a number wrapped onto the next line after its separator is blocked", () => {
  const { decision, ids } = reasons({ text: "Number copied from the photocopy as printed: 000-\n55-0144. Therapy starts tomorrow." });
  assert.equal(decision, "block");
  assert.ok(ids.has("us-ssn-format"));
});
