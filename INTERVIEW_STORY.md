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

---
---

# Interview story: the slow large-file upload (measuring before fixing)

A second, unrelated story from the same app — same file-storage product,
different subsystem (the large-file upload pipeline, not auth). Included
here as a second "tell me about a bug" answer with a different shape: this
one is a performance investigation, not a correctness bug, and the arc is
about *proving where the time goes* before touching any code, not about a
security implication.

---

## The 30-second version

> Large-file uploads in this app get split into 4MB chunks and sent to a
> Telegram-backed storage layer, one chunk at a time. Uploads over roughly
> 10MB felt slow, and a couple of them outright failed with "chunk failed
> after 3 attempts." Before changing anything, I measured: I audited the
> upload endpoint for computational bottlenecks (found none — no slow
> crypto, no expensive DB lookups), then measured the actual chunk request
> in the browser's network panel. Client-side overhead was negligible —
> tens of milliseconds. The request was spending 23-24 seconds sitting in
> "waiting for server response" before getting a success back — over 99%
> of the total time. That number told me exactly what to fix: not the
> client, not the network, but the fact that the client was only ever
> sending one of these 24-second requests at a time, with zero overlap.
> The app already had a proven 6-way-concurrent uploader for a different
> code path (resuming after a page refresh) that had just never been wired
> into the primary "start a new upload" path. Unifying them cut wall-clock
> upload time by roughly the concurrency factor, without needing to make
> any single request faster.

---

## The full story (STAR)

### Situation

Uploading a file larger than ~10MB in this app takes a different path than
a small file: instead of one direct upload, the file is split into 4MB
chunks and each chunk is POSTed individually to a Telegram-backed storage
endpoint, then reassembled server-side. Users reported large uploads
feeling slow, and separately, some uploads were failing outright with a
generic "chunk failed after 3 attempts" error.

### Task

Two distinct things tangled together in one report: an outright failure
(worth root-causing on its own — it turned out to be a separate, unrelated
bug, an auth token silently expiring mid-session with nothing refreshing
it) and a *performance* complaint, which is squishier — "slow" needs a
number before it can be fixed. My task on the performance side specifically
was to find out **where** the time was actually going, because chunked
upload pipelines have several candidate bottlenecks that all produce the
same user-visible symptom: client-side compute (hashing, encryption),
network transfer, or backend processing — and each one implies a
completely different fix.

### Action

I didn't start by changing code. I started by ruling things out, in order
of how cheap they were to check:

- **Audited the endpoint itself for computational cost.** Read the whole
  request path line by line: auth check, a couple of indexed single-document
  database lookups, a permission check that short-circuits immediately for
  the common case (uploading your own file), and — for the one encryption
  mode that does server-side work — a single AES-GCM cipher call over 4MB,
  which is a low-single-digit-millisecond operation, not something that
  produces seconds of latency. Nothing in the code itself could plausibly
  produce a multi-second delay on its own.
- **Reproduced it directly against the real running server**, not a
  synthetic guess — scripted an actual authenticated upload (login, init,
  send real chunks) and confirmed the endpoint completes fast under a
  clean, low-load request. That ruled out "the code path is just broken"
  as an explanation for consistently slow requests.
- **Measured the real thing in the browser's network panel** on an actual
  slow upload, and broke a single chunk request down by phase instead of
  looking at one total number:
  - **Connection setup: under 6ms.** Not a networking/TLS-negotiation
    problem.
  - **Sending the request body (client → server): 50-75ms** for a 4MB
    chunk. Negligible — ruled out client-side compute (hashing, optional
    encryption) and upload bandwidth as the bottleneck.
  - **Waiting for server response: 23-24 seconds.** This is the entire
    story. Whatever the server does between "received the chunk" and
    "sent back success" is where essentially all the time goes.
  - **Content download (the response itself): under 1ms.** The response
    body is tiny (a JSON acknowledgement) — nothing there either.
  - Total: roughly 24 seconds per chunk, **over 99% of it server-side
    processing time**, not network, not the client.
- That number reframed the whole problem. A slow *chunk* isn't
  automatically a slow *upload* — it only is if chunks are sent one at a
  time with nothing overlapping. So I checked exactly that, and found the
  real bug: the primary upload path sent chunks strictly sequentially,
  awaiting each one fully before starting the next. Meanwhile, a
  *different* code path in the same codebase — resuming an upload after a
  page refresh — already ran six chunks concurrently, a pattern that had
  clearly been built and worked, just never applied to the common case of
  starting a brand-new upload. Total wall-clock time for the sequential
  path was therefore chunk-count times 24 seconds, with zero overlap to
  hide it.
- I also added two smaller, evidence-driven fixes discovered along the
  way: the retry logic was ignoring the storage provider's own
  rate-limit signal (a "retry after N seconds" value on a 429 response),
  always waiting a fixed guess instead — now it respects the real value,
  capped so a single request can't block indefinitely if that number is
  unreasonably large. And I left the phase-by-phase timing breakdown
  in as permanent server-side logging, specifically so the *next* "why is
  this slow" question comes with a number instead of another round of
  guessing.
- Before shipping, I unified the two competing implementations (the slow
  sequential one and the proven concurrent one) into a single shared
  function, rather than just copying the fast pattern into a second place
  — this codebase had already been bitten once by two call sites
  reimplementing the same effect and quietly drifting apart, so collapsing
  them into one was worth doing at the same time as the performance fix.
- Verified with real, live traffic rather than trusting the diff: fired
  every chunk of an actual multi-chunk file at the server *concurrently*
  and confirmed no race condition and a correct final result: then did it
  again with **two separate files uploading at once**, each with its own
  concurrent chunk set, interleaved — to mirror what actually happens when
  a user selects two files together — and confirmed neither file's data
  contaminated the other's.

### Result

Total upload time dropped by roughly the concurrency factor for large
files, without making any individual request faster — because the fix
wasn't "make the 24 seconds shorter," it was "stop wasting the 24 seconds
by only ever doing one at a time." The phase-by-phase timing breakdown
now ships as a standing diagnostic, so this class of question doesn't
require re-deriving the same investigation from scratch next time; the
next lever, if the 24-second figure itself needs attacking, is now a
known, logged number rather than a guess — and would mean isolating how
much of it is the third-party API round trip specifically versus this
app's own database writes, which the new logging already separates.

---

## Likely follow-up questions, and how to answer them

**"How did you know it was a server problem and not the network?"**
> I didn't assume it — I broke the request down by phase instead of
> looking at total time. Connection setup and content download were both
> under a handful of milliseconds, and sending the request body itself was
> under 100ms. The only phase with any meaningful time in it was "waiting
> for a response" — over 99% of the total. That's a clean signal: the
> browser handed the data off quickly and then just waited, which only
> happens when the other side is genuinely busy, not when the network
> itself is slow.

**"Why not just make each chunk request faster instead of running them
concurrently?"**
> I did look for that first — it's the better fix if it's available. But
> the endpoint's own code had nothing expensive in it, which meant the
> ~24 seconds was very likely the external API call itself (or possibly
> the hosting platform's own execution characteristics) — not something
> a code change in this codebase can shorten directly. When the fixed
> cost per unit of work can't be reduced, the correct lever is doing more
> units of work at once, not pretending you can make one unit faster
> without evidence.

**"Doesn't adding concurrency risk race conditions?"**
> That's exactly why I didn't ship it on code review alone — I tested it
> against the real backend with real concurrent traffic before calling it
> done, including the harder case of two different files' chunks
> interleaved at the same time, not just one file's chunks running
> concurrently with each other. Every chunk is scoped by its own file and
> chunk index, so the design doesn't share mutable state across concurrent
> requests, but "the design should be safe" and "I confirmed it's safe
> under real concurrent load" are different claims, and I wanted to be
> able to make the second one.

**"You found an existing concurrent implementation elsewhere in the
codebase — how did you find that, and what does it tell you?"**
> I was about to write a worker-pool from scratch when I went looking for
> how the "resume after a page refresh" path handled the same chunking
> problem, and found it already did exactly what I needed, well-tested and
> already proven in production use. That told me two things: first, don't
> build what already exists — reuse it. Second, its existence *elsewhere*
> but not on the primary path was itself a signal worth flagging: two
> independent implementations of the same logic is a maintenance smell on
> its own, regardless of which one is faster, so unifying them was part of
> the fix, not an unrelated cleanup.

**"What would you do next if the 24 seconds itself needed to come down?"**
> I'd use the same phase-level logging I already added, specifically the
> split between the actual third-party API call and this app's own
> database write, to find out how much of the 24 seconds is genuinely
> outside this codebase's control versus something still fixable here. If
> it's dominated by the external API call itself, the next lever is
> usually infrastructure-level (e.g. a self-hosted version of that
> provider's API server, which removes a network hop entirely) rather than
> anything else in application code — a bigger, infrastructure-level change
> I'd scope separately rather than fold into a quick fix.

---

## Notes on delivery

- Open with the *measurement*, not the fix. "I found 99% of the time was
  server-side, and here's the three numbers that proved it" is a much
  stronger opening than "I added concurrency." It shows the investigation
  discipline, not just the outcome.
- This story's strongest signal is different from the session-bug story
  above: that one was about recognizing when to escalate a UI glitch into
  a security investigation. This one is about *not guessing* — ruling out
  cheap explanations before reaching for an expensive fix, and verifying
  the fix against real concurrent traffic rather than trusting the diff.
- If asked to go deeper technically, be ready to explain precisely *why*
  low connection-setup and content-download numbers rule out network
  causes, and why low request-send time rules out client-side compute —
  each phase of a network request timing breakdown maps to a specific
  category of possible cause, and knowing that mapping cold is what makes
  the diagnosis convincing rather than lucky.
