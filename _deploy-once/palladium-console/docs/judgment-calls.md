# Judgment calls — Palladium Demo Console

Recorded so they can be reversed. Newest last.

---

## 1. I took the reference image's CONTENT STRUCTURE instead of its DESIGN LANGUAGE

**What I did wrong.** Given a Google Drive screenshot as a design reference, I
copied its information architecture — quick-access row, "all files" table,
storage meter in the sidebar — and invented my own visual language: a dark navy
edge-to-edge shell on a grey canvas.

That is backwards. The brief was the opposite: take the *look* from the image
and decide the *structure* myself.

**Corrected.** The design language now taken from the image:

- the app is a WHITE CARD with large rounded corners FLOATING on a royal-blue
  ground with faint angular facets — not edge-to-edge chrome
- the sidebar is BLUE, inset *below* the white topbar, with a rounded top-right
  corner, flush to the card's left and bottom
- the primary action is a WHITE PILL sitting on the blue
- search is a pill-shaped light field in the white topbar
- section labels are small, uppercase, letterspaced, grey-blue, and where they
  head a block the rule runs off to the right
- the page title is bold and blue, with a small solid-blue square button beside
  it and the view toggle pushed to the far right
- cards are soft and rounded with a folder tab; the one in use is solid blue

**Structure, which was mine to decide:** one collection with a grid/list toggle,
search, sort and three filters. Not Drive's quick-access + table split. The
reference's storage meter became the sidebar's running-job and estate meters —
the same device carrying real numbers.

**Two content decisions worth flagging**, because they are mine and reversible:

- The **solid-blue card** marks a project someone is currently **holding** for a
  demo. In the reference that treatment marks selection; here selection is not a
  persistent state, and "in use right now" is the thing worth seeing across the
  room. If holds turn out to be rare, the treatment will rarely appear.
- The folder **tab** on each card carries the two-letter code in the project's
  colour. It reads as "a project is a folder of demo material", which is what a
  project without a live agent actually is.

**Reverse.** `web/index.html`, `web/assets/app.css` and the view functions in
`web/assets/app.js`. The previous dark shell is in git history at 1289c04.

---

## 1b. Two small removals that came with the redesign

- The topbar's **environment chip** ("console admin" / "member") is gone; the
  reference's topbar carries a name and an avatar and nothing else. The console
  role is now stated in the account control's tooltip, and it is *visible* as
  consequence: only an admin is offered "New project". If the role needs to be
  readable at a glance, put it back as a line under the name.
- The e2e suite now treats a **403 on an action endpoint as an expected
  outcome**, because a project agent refusing a token it does not accept is
  fail-closed working correctly and the browser logs the response either way.
  What the suite asserts instead is that a refusal never reads as a success.
  If that allowance ever hides a real fault, narrow it to the specific project.

---

## 2. Routing the console through the k3s ingress

**Decided.** Created a Service with no selector + EndpointSlice + Ingress in the
`nhdw` namespace so `console.20.84.70.78.nip.io` reaches the host container.

**Why.** The cloud firewall admits only 80/443, and k3s owns 443. Without this
the console was unreachable from outside despite running correctly.

**The cost, stated plainly.** It is a cluster resource for a non-NHDW app, so it
is NOT in the NHDW manifests and will NOT survive a from-bare provision. The
durable answer is one firewall rule for 8443 and Caddy serving directly.

**Reverse.** `kubectl -n nhdw delete ingress ing-palladium-console svc
palladium-console-ext endpointslice palladium-console-ext`.

---

## 3. Caddy issues an internal certificate rather than a real one

**Decided.** `CONSOLE_TLS=internal` by default.

**Why.** The host is IP-only with blocked ports, so ACME cannot validate. My
first attempt defaulted to Let's Encrypt, failed on every issuer, and queued a
month of retries while serving nothing.

**Cost.** One browser trust prompt. Setting `CONSOLE_TLS` to an email address
switches to a real certificate once a DNS name and open 80/443 exist.

---

## 4. The console owns passwords, and registration is open by default

**Decided.** Local accounts with PBKDF2-HMAC-SHA256 from the standard library,
single-use password-reset tokens (hash stored, not the token), and **open
registration** — anyone can create an account.

**Why.** Single sign-on is not configured on this console and may not be for a
while; without local accounts the only way in is the development backdoor, which
is exactly the thing that must not be how people get in. Open registration is
safe here because an account with no grant reaches nothing at all: it is a way to
get on the roster so an admin can grant something, not a way in. PBKDF2 rather
than argon2/bcrypt because it adds no dependency to an image that has to build
on an air-gapped host.

**Cost, stated plainly.** Anyone who can reach the console can create a row in
the roster. `CONSOLE_OPEN_SIGNUP=false` turns it off and makes the console
invite-only.

**Reverse.** `CONSOLE_OPEN_SIGNUP=false`, or delete the local-account block from
`app/schema.sql` and the `/auth/register|password-login|forgot|reset` routes.

---

## 5. No mail relay is configured, so reset links are handed over by an admin

**Decided.** `CONSOLE_SMTP_*` is unset. A self-service reset says an admin must
issue the link; an admin issues one from Admin → People & access and hands it
over. On a `CONSOLE_ENV=dev` console with no relay, `/auth/forgot` returns the
link in its response so the flow is testable.

**Why.** A console that starts sending real email the moment it boots is a bad
surprise, and this estate already has one service wired to a real inbox. The
honest alternative works without it.

**Cost.** Password reset needs an admin in the loop. Setting the five SMTP
variables removes that.

---

## 6. The developer sign-in takes a name

**Decided.** The dev sign-in field accepts a username, and the identity it
creates is a MEMBER unless it is the first account on the console.

**Why.** It previously handed out console admin to every developer identity, so
a second dev sign-in silently became an administrator. It also made it
impossible to see what a member sees, which is the half of access control worth
testing. It is still refused outright unless `CONSOLE_ENV=dev`.

---

## 7. A "Pd" monogram stands in for the Palladium logo

**Decided.** The sign-in screen shows a rounded square with **Pd** — palladium's
chemical symbol — beside the word *Palladium*, with *Demo Console* beneath it.

**Why.** I do not have the real Palladium asset, and drawing an approximation of
somebody's actual trademark is worse than an obvious placeholder.

**Reverse.** Replace the one `<svg>` inside `.brand-lg .mark` in
`web/index.html`. Nothing else references it.

---

## 8. The Palladium logo, and how it is stored

**Superseded call 7.** The real lockup arrived, so the "Pd" placeholder is gone.

**Decided.** The supplied JPEG lives at `brand/palladium-logo-source.jpg`, and
`tools/make-brand-assets.py` derives everything the app renders from it: the
full lockup, the cP mark alone for the topbar, and the tab icon. The two logo
assets are **alpha masks** — no colour of their own — and the page paints them
in the current theme's ink.

**Why a mask rather than a PNG of black artwork.** The console has a light theme
on a white card and a dark theme on a near-black one. A black PNG disappears in
the second, and shipping two exports means they drift. A mask is one asset that
is correct in both, and it needs no re-export when the palette changes. It also
removes the white background properly, rather than keying it out at display
time.

**A note on the cut.** The mark cannot be separated from the wordmark by looking
for an empty column — further down, the cP mark and the P of *Palladium* leave
no gap between them. It is cut instead by how far ink reaches in the TOP of the
lockup, where the mark stands alone above the wordmark's cap height.

**Reverse / update.** Drop a new file at `brand/palladium-logo-source.jpg` and
re-run `python3 tools/make-brand-assets.py`. Nothing else needs touching.

---

## 9. The topbar search box became the estate bar

**Decided.** The topbar's middle column carried a search box whose only job was
to open the command palette. It is now a live **estate bar** — a count per
status of what the console can actually reach, and the running job while there
is one. The palette moved to an icon button in the right cluster, where it keeps
its keyboard shortcut.

**Why.** A full-width control that duplicates a keyboard shortcut is expensive
real estate for one action. What belongs in the most visible strip of an
operator's screen is the state of the thing being operated.

**The duplication this created, and how it was resolved.** The sidebar already
carried an estate meter, so this would have said the same thing twice. The
sidebar's estate meter was REMOVED; what stays there is the running job, which
is the one thing on the screen that is about *you* rather than about the estate.
Each now has a distinct job: the topbar answers "what is the state of
everything", the sidebar answers "what am I waiting on".

**Reverse.** `.estatebar` in `web/assets/app.css`, `renderFleet()` in
`web/assets/app.js`, and the topbar block in `web/index.html`.

---

## 10. The sign-in artwork is a still, not the globe

**Decided.** The sign-in panel shows the supplied cube-burst piece, blended onto
the panel with `mix-blend-mode: screen` so its black ground disappears into the
panel instead of sitting there as a pasted rectangle. That IS the background
removal — done at paint time, no pixels keyed.

**The globe is kept in full**, because this was asked for as an experiment. One
constant decides:

    const ART = 'login-art.jpg';      // the cube burst      (current)
    const ART = 'login-art-alt.jpg';  // the painted arcs
    const ART = null;                 // the rotating globe

Both source files are in `brand/`; the served copies are 1200px JPEGs.

**Also.** The card is now landscape (1040×624) and stays that way in all four
of its modes — the register form is the tall one, so the form column scrolls
inside the card rather than stretching it. Everything on the sign-in form sits
above the fold, which the browser suite now asserts rather than trusts.

---

## 11. The ground is the supplied artwork; the boards float on it

**Decided.** The drawn facet polygons are gone. The whole-app background is the
supplied striped piece (`brand/app-bg-source.avif` → `web/assets/app-bg.jpg`,
upscaled to 2560px — it is a soft abstract, so it carries the upscale), with a
theme-aware scrim over it.

**Why a scrim rather than the bare image.** A white card directly on a
full-strength photograph fights it: the card stops reading as *above* something
and starts reading as a hole cut into it. The scrim is one token,
`--ground-scrim`, lighter in the light theme and heavier in the dark, so one
file serves both.

**Floating.** Both boards — the app card and the sign-in card — now share one
shadow token: a tight contact shadow, a wide soft drop, and a hairline rim so
the edge catches light instead of ending abruptly. The sign-in card also lifts
in on load, and does not under `prefers-reduced-motion`.

---

## 12. The blend belongs with the artwork, not with the panel

**Decided.** `ARTWORK` in `web/assets/app.js` maps each file to how it should be
painted:

    'login-art-alt.jpg': { blend: 'normal', opacity: 1 }     // the painted arcs
    'login-art.jpg':     { blend: 'screen', opacity: .92 }   // the cube burst

**Why.** `screen` is what makes a piece on a BLACK ground vanish into the panel
— that is how the cube burst loses its background without a pixel being keyed.
Applying the same treatment to an edge-to-edge painting washes the paint out and
takes the caption with it. Hard-coding one blend on the panel would mean the
next artwork someone drops in is wrong half the time.

**Related.** The caption now carries its own bottom gradient rather than relying
on whatever happens to be behind it, so it holds on any piece.

---

## 13. No scrollbar on the sign-in card

**Decided.** `.login-form` is `overflow: hidden`, and the type and spacing are
sized so the TALLEST of the four forms — register, with four fields — fits.

**Why.** A scrollbar down the middle of a sign-in card reads as broken, and the
control below the fold is always the one somebody needs. The browser suite
asserts zero overflow rather than trusting it, so the next field somebody adds
fails the suite instead of quietly reintroducing the scroll.

**What went to make room.** The footnote under the form, which repeated the
register lede word for word.

---

## 14. The developer sign-in is gone, endpoint and all

**Decided.** `/auth/dev-login` is deleted from the backend and from the screen.
Everything signs in with a password now, tooling included: `tools/seed-demo.py`
takes `--admin` and `--password`, and the browser suite takes `CONSOLE_ADMIN`
and `CONSOLE_ADMIN_PW`.

**Why not just hide the button.** A way in that skips the password is a way in,
whatever it is called and however carefully it is gated. Leaving the endpoint
behind a hidden UI would have been worse than leaving the button: the same door,
harder to notice. On a console with no accounts the seeder registers its admin
instead, because the first account is always a console admin — which covers the
bootstrap case the back door existed for.

**Cost.** Driving a console now needs a real account. That is the point.

---

## 15. Three tabs, not five

**Decided.** A project has **Overview** (is it up, what is it showing),
**Resources** (the material) and **Controls** (what you can change and press —
profiles, demo actions, the hold). The People and History tabs are gone.

**Why.** Who may reach a project, and what has happened across the estate, are
the CONSOLE's business rather than a project's, and both already have a home in
Admin. Carrying them per project as well was two more tabs restating what one
screen already said. The organising principle is now LOOK · SHOW · CHANGE, which
is short enough to hold in your head when deciding where something new belongs.

**What moved.** The demo actions left Overview for Controls, where the other
things you press already were. Overview gained "Lately" — the last few events on
this project — which is the part of the old History tab that was actually worth
seeing without asking for it.

---

## 16. The project header is a gradient with range

**Decided.** `--hero-1/2/3` run from a mid slate through charcoal to near-black,
with a soft key light and one broad highlight sweep across the panel.

**Why.** The previous "gradient" ran near-black to near-black, which is not a
gradient — it is a dark rectangle with extra CSS. It also carried four facts;
it now carries two, because a role and a "resource folder" restate what the
status pill and the disabled controls already say.

---

## 17. Inputs have no border

**Decided.** Form fields are borderless: a fill that is not quite the card, and
a shadow under it. Focus adds a ring and lifts the field a pixel.

**Why.** A bordered box on a white card reads as a cell in a form; a floating
bar reads as something you type into. The type went up in weight to match — the
sign-in board was set thin enough to look tentative.

---

## 18. The ground, third attempt

**Rejected twice, and both rejections were right.** The supplied striped image
was too busy behind a white card. My replacement — angled facet planes drawn in
CSS — was worse: hard-edged wedges that competed with the card instead of
sitting behind it.

**What it is now.** No edges at all. A deep diagonal ramp, two very soft lights
well off-centre, a vignette, and a fine grain. The grain is not decoration: a
large smooth gradient bands visibly on an 8-bit display, and a few percent of
noise is the standard cure.

**The principle I should have started from.** A background's job is to recede.
Anything in it with an edge competes with the thing in front of it, and on this
screen the thing in front is the whole product.

**Reverse.** `.ground` in `web/assets/app.css`. The two supplied images are
still in `brand/` if either is wanted back.

---

## 19. Shadows go all the way round

**Decided.** Every lifted surface — cards, inputs, the app card, the sign-in
board — uses an even halo (a shadow with no y-offset and a wide blur) plus a
small directional drop.

**Why.** A shadow with only a y-offset pools underneath and reads as a sticker
taped to the page. The halo is what makes it read as an object standing *off*
the surface; the small drop is what stops it floating without weight. One pair
of tokens now carries it, so nothing drifts.

**Inputs specifically** are off-white rather than white. A white field on a
white card has nothing but its shadow to separate it, which reads as a printing
error rather than a control.

---

## 20. Creating a project is a folder, not a button

**Decided.** The `+` beside the title is gone. Creating a project is an empty
folder at the end of the shelf — the same silhouette as a project card, tab and
all, drawn as a dashed outline. The list view carries the same affordance as a
row at the foot of the table.

**Why.** The action's subject is a project, and it now looks like one: a place
for the next one, sitting where the next one will be. A button in the page
chrome describes the same action without showing you where its result will go.

**One rule that came with it.** The tile disappears while a filter or search is
active. An "add" item inside a filtered result claims to be part of that result,
and "3 of 4 projects" followed by four tiles is a small lie the interface would
be telling every time somebody typed.

**Reverse.** `addCardHtml` / `addRowHtml` in `web/assets/app.js`, `.pcard.add`
and `tr.addrow` in `web/assets/app.css`.

---

## 21. The suite waits for the network instead of sleeping at it

**Decided.** Where the suite drives something that reaches another host — the
demo action list — it waits for the result to appear rather than sleeping a
fixed number of seconds and reading whatever is there.

**Why.** It failed once on a slow answer from the gateway and reported "an
action was available to run" as false. That is a suite telling a lie about the
thing it exists to watch, and the fix is not a longer sleep: a longer sleep
fails the same way on a slower day, just less often.

---

## 22. The sign-in panel is three zones, not a stack

**The problem.** It was a form dumped in a white box: logo, heading, paragraph,
two labelled fields, button, two links — each stacked on the last, all of it
hanging from the top. Competent and completely generic.

**Decided.** The panel is a three-row grid with a guaranteed gap between rows:

- **top** — the mark, anchored
- **middle** — the form, optically centred in whatever space is left
- **foot** — the ways out, pinned behind a hairline

The zones hold while the middle one changes between the four forms, so the
panel does not jump as you move between them, and a tall form can never slide
its heading up under the mark.

**Four decisions inside that:**

1. **The heading carries the thesis on the way in** — *Every demo, one place.*
   in display type — and the task on every other screen. The artwork used to
   repeat that line in its corner; saying it once, in the largest type on the
   panel, beats saying it twice. The artwork's caption is gone.
2. **The display size belongs to the thesis.** The other three forms are tasks
   with more fields and less to announce, so the heading steps down rather than
   the card growing to accommodate a shout it does not need.
3. **The fields use the console's own label idiom** — small, uppercase,
   letterspaced — the same one every panel header in the app uses, so the way in
   looks like the thing it leads to.
4. **Username and full name share a row** on the register form. It is one line
   less to read, and it stops the tallest of the four forms dictating a card
   that everything else then rattles around in.

**The card went from 1040×704 to 1000×572** on the back of those, with every
form still scroll-free.

---

## 23. The empty folder gets the same shadow as a full one

**Decided.** `.pcard.add` carries `--shadow-card` and a paper background, like
every other folder on the shelf. The dashed outline is what says it is empty;
the shadow is what says it is a folder.

**Why the first version was wrong.** It had no shadow at all, so it read as a
hole in the shelf rather than an empty folder sitting on it — the one thing
distinguishing it became "less real" instead of "not filled in yet".

---

## 24. A passing check beside a visible defect

**What happened.** The sign-in form had a "does it scroll?" assertion that
reported zero overflow while the register heading was visibly crowding the
mark. Both readings were correct. The middle zone was 44px taller than its grid
row and, being centred, spilled UPWARD over the mark — and the form as a whole,
with `overflow: hidden` and a fixed height, still reported no scroll.

**Why this is worth recording.** The check was not wrong, it was measuring the
wrong thing: a symptom the fault does not produce. That is worse than no check,
because it reads as coverage.

**Fixed both ways.** The card grew to fit its tallest form, and the suite now
measures the gap between the mark and the heading in all three modes — the
quantity that closes to zero exactly when this breaks.

---

## 25. A white halo on the sign-in board, and no ring

**Decided.** The board has its own complete shadow stack rather than the shared
`--shadow-app` token: a weighted dark drop for gravity, then a 52px white glow
and a 150px white bloom. No spread ring at any layer.

**Why the artwork half needed it.** It is nearly as dark as the ground behind
it, so without light around the edge the card simply dissolves on that side and
stops having a shape.

**Why its own stack.** The shared token carries `0 0 0 1px` — a spread ring. On
every other surface that reads as a hairline catching light. On this board,
against a near-black ground, it read as a drawn BORDER, and there is no way to
drop one layer of a token while keeping the rest. So the separation here comes
from light alone, which is also what let the glow go strong without the edge
looking outlined.

---

## 26. The work surface is printed paper

**Decided.** The main content area carries a drawn background — two sweeps of
fine curves, one low left, one high right, with the middle deliberately empty —
rather than a flat fill. It is generated by `tools/make-canvas-art.py`, in a
light and a dark cut, and the dark cut is *redrawn on a dark ground*, not
inverted.

**Why.** An inversion of light-grey hairlines gives white-on-black at fifty
lines per inch, which is glare, not texture. Redrawing costs one more colour
triple and keeps the motif quiet in both themes.

**Two things it gets right that are easy to get wrong.** The image is stretched
to the box (`100% 100%`) rather than `cover`: the composition's whole point is
an empty centre, and `cover` crops whichever axis does not fit, which drags a
sweep in underneath the cards. And the lines are far paler than the reference
sheet — a reference poster is looked at, this is looked *through*.

**To revert.** Drop `--canvas-art` back to nothing and `.canvas` to
`background: var(--paper)`.

---

## 27. The ground is blurred on its own layer

**Decided.** The backmost artwork is blurred, and the blur lives on
`.ground::before`, inset `-8%` and scaled slightly, not on `.ground` itself.

**Why.** A filter on `.ground` would blur the app card in front of it too. And
a blurred image shrinks away from its own edges — the softening has to happen
outside the viewport or it leaves a pale seam all the way round.

---

## 28. The dead action renderer is gone

**Decided.** `loadActions()` and the `.action` stylesheet block are deleted.
Actions render as control rows now, and had done since the Controls tab landed;
the old renderer had no caller.

**Why.** The suite was still watching `.action`, so it reported a missing
feature that was on screen and working — a test watching a shape nothing emits
tells you nothing, and eventually tells you something false. The check now
watches `[data-act="run-action"]`, which is what ships.

---

## 29. The Overview is documentation first, health second

**Decided.** The Overview opens with a five-section write-up of the project —
what it is, who it is for, what to show, how it is built, what to be careful
about — and the health check sits below it.

**Why.** A console that only said whether a thing was running assumed the reader
already knew what the thing was. Somebody handed a project an hour before a
meeting does not, and that is exactly the person this console exists for.

**Why five fixed sections rather than free text.** Free text gets written once,
by whoever set the project up, in whatever shape suited them that day. Fixed
sections mean every project reads alike and the gaps are visible: the page shows
`2/5 sections written` and names the three nobody has answered.

---

## 30. Creation and presentation read the same list

**Decided.** `DOC_SECTIONS` lives once, in `app/main.py`, and is served at
`/api/doc-sections`. The create form builds a field per entry; the Overview
builds a section per entry; the PATCH route accepts exactly those keys.

**Why.** This was the owner's instruction stated as a general rule, and it is
the right one: a presentation component without a data source behind it is how a
page starts lying. With one list, a section cannot exist on the page with no way
to fill it, and cannot be collected at creation with nowhere to appear. Adding a
section is one edit; there is no second place to forget.

---

## 31. A note's attachment is not shelf material

**Decided.** Note attachments are rows in `console.resource` with
`kind = 'note'`, and the Resources query excludes that kind.

**Why.** The same table means an attachment gets the same size limit, the same
PDF rendition, the same range-serving and the same deletion path — writing a
second, poorer file path for notes would have been the real mistake. But the
Resources tab is *curated*: it is what you chose to show a client. An aside to a
colleague appearing there would make the shelf noisy and the choice meaningless.
One table, two audiences, one filter.

---

## 32. The back link says where it goes

**Decided.** A sub-page carries "‹ All projects", not a bare arrow, and not
reliance on the browser's back button.

**Why.** Browser back is not an answer: somebody who arrived by a pasted link
has no history, and somebody who has clicked around has too much of it. A named
destination is the same for both.

---

## 33. The app card loses the glow

**Decided.** The white halo stays on the sign-in board and is gone from the app
card, which now carries depth only.

**Why.** The halo suits a small object adrift on a large dark field — which is
what the sign-in board is. The app card fills the window; it does not need help
being found, and light around something that large reads as a glow rather than
as a shadow. The sidebar gradient does the separating instead: diagonal,
bottom-right to top-left, holding its darkest value until near the corner.

---

## 34. The Overview is documentation and nothing else

**Decided.** The component checklist and the event log are gone from the
Overview. What is left is a document: a kicker, a lede, five sections of prose
at a readable measure, and an "On this page" rail beside it.

**Why.** Two scrolling tables of machine output are not how you explain what a
thing is, and they were the first thing on a page whose entire job is to
explain. The owner's word for it was "terrible", which is fair.

**Where the information went** — neither list was deleted outright, because both
are real. The component detail now hangs off the **status** in the header, which
is the thing it explains and where status was already shown; it appears only
when there are checks to show. The event log belongs to **Admin**, which is
where the estate's history is read, and it was already there.

---

## 35. The page cannot scroll; the content inside it can

**Decided.** `html, body { overflow: hidden }`, the gutter is **padding on the
body**, and the card is `height: 100%` of what remains.

**Why the change of mechanism, not just an overflow rule.** The card was sized
`100dvh - 2 * gutter` with a matching *margin*. That only lands exactly if `dvh`
and the body's `%` agree and a `clamp()` gutter divides evenly — and when they
disagree by a pixel, the whole application scrolls by a pixel. Padding on the
frame and `100%` inside it cannot disagree with itself.

**Watch for.** `.signin` had its own `100dvh` and its own gutter; with the body
padding it would have been double-inset and clipped, since the page can no
longer scroll to reveal what overflows. It is `height: 100%` with no padding of
its own now. Anything else full-height added later has the same obligation.

---

## 36. The bottom edge fades, but only while there is more below it

**Decided.** The content area fades into the card's paper over its last 68px
when something is below the fold, and does not otherwise.

**Why both halves.** A hard edge on a scrolling page ends a sentence mid-word
against the card and reads as chopped rather than as scrollable. But a permanent
wash is the same lie in reverse: it tells a reader who has reached the end that
there is more to come. The fade has to mean something, so it is conditional.

**Why a MutationObserver rather than a call in each renderer.** `paint()` runs
*before* a tab fills its body — every tab paints a shell and then loads into it
— so measuring there measures the wrong page. Calling it at the end of each
renderer works until somebody adds the eleventh renderer and forgets, and then
one page has a hard edge for no reason anybody can see. Watching the subtree
cannot be forgotten.

**Why on `.main` and not `.canvas`.** On the scrolling element it would move
with the content it is meant to be fading. It also takes no pointer events — a
fade that swallowed a click on the row beneath it would be worse than the edge
it replaced.
