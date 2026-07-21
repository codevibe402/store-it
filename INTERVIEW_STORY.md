# Interview story: the account-switching session bug

How to talk about the ambient-session-bridging bug, its fix, and the
explicit-only exchange refactor in an interview. Technical background is in
`SESSION_EXCHANGE_VULNERABILITY.md` — this document is about *telling* the
story, not re-deriving it.

---

## The 30-second version

*(For "tell me about a challenging bug you fixed" with no follow-up room.)*

> I was working on a file-storage app with a zero-knowledge encryption
> feature. Users reported a "recover your files" prompt popping up in weird
> places — after opening a shared folder link, and during logout. One
> report stood out: a user said clicking "Skip" on that prompt left them
> looking at a completely different account's files. I traced it to a
> session-bridging endpoint that silently trusted a leftover login session
> from a browser tab, instead of only trusting logins that had just
> actually happened. Because the cookies involved were browser-wide, not
> per-tab, that meant opening a link in a new tab could quietly swap which
> account the *whole browser* was authenticated as — a real cross-account
> exposure, not a UI glitch. I fixed the immediate trigger, then replaced
> the whole pattern with one where session bridging only ever happens as
> the direct result of an explicit login action, never as a background
> guess.

---

## The full story (STAR)

### Situation

The app had a zero-knowledge encryption feature — files can be encrypted
client-side with a key the server never sees, and a device that doesn't
already have that key locally needs a recovery code to unlock them. Users
started reporting that a "recover your encrypted files" prompt was showing
up unpredictably: right after opening a shared folder link someone sent
them, and again during logout. Those two triggers had nothing to do with
"I'm on a new device" — the prompt's own stated reason for existing.

One report was more serious than a UI annoyance: a user said that when they
clicked "Skip" on that prompt, they ended up looking at a *different
account's* files — an account they hadn't logged into.

### Task

Two things, in order. First, fix the modal appearing where it shouldn't —
that part was reproducible and clearly cosmetic on its own. Second — and
this was the part I couldn't treat as routine — determine whether "ended up
in a different account" was user confusion (e.g. they'd forgotten they were
in a different browser profile) or an actual session-handling bug, because
if it was real, it meant one user could end up looking at another user's
private data with no deliberate action on either side.

### Action

I started from the modal, since that was the concrete, reproducible symptom,
and worked backward to find *why* it was firing.

- The modal is owned by a provider component mounted once, at the root
  layout — meaning it runs on **every page**, including a public
  share-link page that isn't supposed to know or care who's logged in.
  That was the first smell: a component that should only matter for the
  authenticated app was wired into a page that explicitly isn't.
- Digging into what actually decides whether that modal shows, I found the
  app runs two separate identity systems side by side: an OAuth library
  handling Google/Telegram login, and the app's own JWT-based session that
  every API route actually checks. A bridging endpoint takes whichever
  session the OAuth library currently reports and mints the app's own
  session cookies from it.
- That bridge was being called *ambiently* — by a background effect that
  fired any time it noticed "the OAuth library says authenticated, but we
  don't have app-level cookies yet," with no check on *why* that was true
  or whether the account it was about to authenticate as was the one
  actually in use.
- That's when it stopped being a UI bug. Those app-level cookies are scoped
  to the whole browser, not to a single tab. So the failure mode was
  concrete and reproducible: if a stale login session for a *different*
  account was still sitting in the browser — say, a Google login tried
  once, weeks earlier, never fully signed out — simply opening a share link
  in a new tab was enough to silently re-mint the browser's session cookies
  for that other account. Not just in that tab — for every open tab. No
  login screen, no confirmation, nothing. That explained both symptoms at
  once: the recovery modal was firing because it correctly didn't recognize
  the account it had just been silently switched into, and the "different
  account" report wasn't user error — it was exactly what the code did.
- I also found a second instance of the same underlying mistake: during
  logout, the OAuth library's client-side "am I logged in" status doesn't
  flip synchronously with the actual sign-out call. That left a window
  where the same ambient bridging logic could re-fire and quietly
  re-authenticate the user seconds after they'd explicitly logged out.
- I fixed it in two passes rather than one big rewrite. First, a scoped,
  low-risk fix: exclude the public share route from that bootstrap logic
  entirely (it never needed the app's session at all), and add a
  synchronous guard so the logout race couldn't resurrect a session.
  That closed the two reported symptoms immediately.
- But the underlying shape — "trust whatever session happens to be
  present" — was a general risk, not something specific to those two
  pages. So as a second pass, I proposed removing the ambient trigger
  entirely: the bridging call now only ever runs as the *direct
  continuation* of an actual login action, for each of the three login
  methods. Two of them (credentials, Telegram) complete in the same page
  without leaving it, so the bridge call sits right where the login
  succeeds. The third (Google) does a full-page redirect through Google
  and back, so there's no shared code path to hook into directly — that
  one gets a one-time marker on the redirect URL that only that specific
  login flow can set, consumed once and then stripped from the URL.
- Separately, I redesigned the recovery-code UX itself: it used to
  auto-trigger any time the app couldn't find a locally cached key, which
  is exactly the ambient pattern that caused the bug. Now it only ever
  opens from an explicit "I have my recovery code" action on the sign-in
  page — nothing shows unless the user asks for it.

### Result

What looked like a UI annoyance turned out to be a real cross-account
session confusion vulnerability — the kind of thing that matters a lot more
than usual in a product built around a zero-knowledge encryption promise,
where "wrong account" can mean exposing the existence of files a user isn't
even supposed to know about. The fix closed both the reported symptom and
the general case, not just the two pages where it happened to surface.
I also wrote up a short internal postmortem afterward: naming the pattern
(it's a known bug class — related to confused-deputy and session-fixation
vulnerabilities), where else it tends to show up, and a short checklist for
reviewing future auth code — so the lesson outlives the specific bug.

---

## Likely follow-up questions, and how to answer them

**"How did you confirm it was a real bug and not the user being
confused?"**
> I didn't take the report at face value or dismiss it — I traced the
> actual code path the modal depends on and found the mechanism that would
> produce exactly that symptom: a cookie-scope issue (browser-wide, not
> per-tab) combined with an ambient trust decision. Once I could describe a
> concrete sequence of actions that reproduces "different account, no login
> action taken," it stopped being a matter of opinion.

**"Why didn't you just delete the OAuth library and use one session
system?"**
> That's genuinely the cleanest long-term fix, and I said so — but it's a
> much bigger, riskier change touching every login path, for a problem that
> had a narrower, fully sufficient fix. I try not to reach for the biggest
> possible rewrite when a smaller, well-reasoned change closes the actual
> risk. If the two-system architecture caused more problems later, that's
> the point where the bigger rewrite would pay for itself.

**"What would you do differently, or what's still not ideal?"**
> The fix I shipped closes the specific bridging pattern that caused this.
> There's a structural version of the same fix I'd do if I were starting
> the app over: keep public and authenticated routes in physically separate
> layouts so a component like this one is *impossible* to mount on a public
> page, rather than relying on a runtime check that a future change could
> accidentally remove. I documented that as a known gap rather than
> quietly leaving it unmentioned.

**"How do you stop this class of bug from being written again?"**
> I don't think a single fix is enough on its own — I wrote up the pattern
> as a named, recognizable shape ("ambient session bridging"), listed other
> places in the industry where the same mistake shows up, and turned it
> into a short review checklist: specifically, "does anything mint or
> refresh a credential inside a background effect with no explicit user
> action in its call chain" is now something to check for in any future
> auth code, not just something I happened to catch this once.

**"Walk me through why cookies being browser-wide mattered here."**
> The session tokens involved were set with a cookie path that scopes them
> to the whole app, which in a browser means they're shared across every
> open tab — cookies aren't isolated per tab the way, say, an in-memory
> variable would be. So an action taken in one tab (opening a share link)
> could change what every other tab was authenticated as, which is a much
> bigger blast radius than "that one tab looks wrong."

---

## Notes on delivery

- Lead with the *symptom a user actually reported*, not the architecture —
  interviewers engage with "a user ended up in someone else's account" much
  faster than "there were two session systems."
- The strongest signal in this story isn't the fix itself, it's the
  judgment call in the Task section: recognizing when a reported UI glitch
  needed to be escalated and investigated as a security issue instead of
  patched at face value. Don't rush past that part.
- If asked to whiteboard or go deeper technically, the table in
  `SESSION_EXCHANGE_VULNERABILITY.md` §7 (which rule closes which category,
  and why) is good material for a "how do you think about authentication
  architecture in general" follow-up.
