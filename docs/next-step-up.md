# "Next step up" — design (2026-10-28, not built yet)

**Goal.** A seeker looking at a job on TarboroJobs sees, in one small card, where that job
leads: the next rung, what it pays locally, and the one local class or certificate that gets
them there. Not career advice; a ladder with the next rung lit up.

**Who it's for.** The default visitor: no resume, no office background, about to apply at a
store, a kitchen, a plant or a care home. The card must make sense to them in five seconds.

## What the seeker sees

On every job page, under the Pay / Type / Where strip:

> **Where this job leads**
> Cashier → Shift lead (pay: $14–17/hr locally) → Store manager
> Get there faster: *Career Readiness Certificate* at Edgecombe Community College (free, a few weeks) · [see it](https://edgecombe.edu/continuing-education/hrd/career-readiness-certificate/)
> **3 shift-lead jobs open now →** (links to the board filtered to that rung)

The rung's job count comes from our own board (title keyword match), so the card is only
shown when it has something real to say: a next-rung title we recognise, and either a local
class or at least one open job at that rung. Otherwise nothing is rendered.

Also on the resume builder's last screen: "You picked *Stores & restaurants*. Jobs there
usually go: Crew → Shift lead → Assistant manager. Here's the one class that helps."

## The ladders (config, in `shared/site.js` → `SITE.ladders`)

Each ladder is a list of rungs. A rung has `titles` (keywords that match job titles on the
board), an optional `pay` hint (local, hourly), and optional `learn` (a local class).

```
Stores & restaurants
  Crew / Cashier / Sales associate / Team member / Stocker
  → Shift lead / Key holder / Shift manager        learn: Career Readiness Certificate (ECC, free)
  → Assistant manager / Store manager               learn: ECC Business Administration
  (kitchen branch) Cook / Food prep → Line cook / Kitchen lead → Kitchen manager / Chef
                                                    learn: ServSafe (not at ECC yet — link to NC Restaurant & Lodging Assoc.)

Factory & warehouse
  Production operator / Assembler / Picker / Loader
  → Forklift operator (pay bump)                     learn: forklift certification (employer-paid usually; ECC Short-Term Training)
  → Machine operator / Maintenance tech              learn: ECC Industrial Systems Technology
  → Welder                                           learn: ECC Welding (continuing ed, financial aid)
  → Supervisor / Team lead

Healthcare
  Housekeeper / Dietary aide / Sitter
  → Nurse Aide I (CNA)                               learn: ECC Nurse Aide I (financial aid available)
  → Nurse Aide II / Medication aide / Phlebotomist   learn: ECC Nurse Aide II · Medication Aide · Phlebotomy
  → LPN → RN                                         learn: ECC Nursing (PN, ADN)

Driving
  Delivery driver / Stocker with license
  → CDL-B → CDL-A                                    learn: CDL — not at ECC; nearest is Nash CC / Wilson CC (verify)

Schools
  Substitute / Teacher assistant / Bus monitor
  → Teacher assistant (full time) → Early childhood lead   learn: ECC Early Childhood Education
  → Teacher (needs degree)                           learn: ECC College Transfer

Office & government
  Clerk / Front desk / Data entry
  → Administrative assistant / Office manager        learn: ECC Office Management · Northstar Digital Literacy (free)
  → 911 telecommunicator / BLET (police)             learn: ECC Law Enforcement/BLET (financial aid)
  → EMT                                              learn: ECC EMS (EMT Basic, financial aid)

Construction & trades
  Laborer / Helper
  → Electrician helper → Electrical tech             learn: ECC Electrical Systems Technology
  → Facility maintenance                             learn: ECC Facility Maintenance Worker
  → OSHA 10 (quick credential)                       learn: ECC (disclosure listed; verify class)
```

Pay hints come from our own board where we have them (median of `pay_min` for jobs matching
the rung's titles in the last 60 days), else left blank — never invented.

Sources confirmed today: edgecombe.edu/programs and edgecombe.edu/continuing-education
(Nurse Aide I/II, Phlebotomy, Medication Aide, EMT, BLET, Welding, Career Readiness
Certificate, Northstar Digital Literacy, Small Business Center; occupational-extension
classes cost $70–$180). Not at ECC: CDL, HVAC, ServSafe, forklift, pharmacy tech — those
rungs link out or say "ask the employer" until a local provider is confirmed.

## Multi-city

The ladders are the same everywhere; only `learn` links are local. For a new city the config
needs its community college's program URLs swapped in — one file. The title-keyword matching
and the "open now" counts work off that city's own board automatically.

## What is NOT in v1
- No AI, no per-person advice, no tracking of a seeker's position on a ladder.
- No pay data from outside our board.
- No "apply to the next rung" automation; the card links to the filtered board.

## Build plan (when the pacer is GO)
1. `SITE.ladders` config + `shared/ladder.js`: `rungForJob(job)` (title keyword → ladder + rung),
   `nextRungs(rung)`, `jobsAtRung(rows, rung)`. One test file.
2. Job page card (App.jsx) + resume builder final-screen line (ResumeBuilder.jsx).
3. Analytics event `ladder_click` so the pulse email can say whether anyone uses it.
Estimate: one Sonnet worker, half a day. Review: Fable, 20 minutes.
