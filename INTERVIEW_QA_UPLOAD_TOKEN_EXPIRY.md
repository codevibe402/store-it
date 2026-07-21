# Interview Q&A: "large uploads randomly fail with chunk errors"

A short, Q&A-first writeup of a bug found and fixed 2026-07-21 (commit
`a6f08b7`). Companion to `INTERVIEW_STORY.md` (a different bug, the
account-switching session issue) — same app, same general area
(authentication/session handling), different root cause. Use this format
when an interviewer wants rapid-fire Q&A rather than a full STAR story.

---

**Q: Give me the 30-second version. What was the bug?**

> A file-storage app I was working on stored files two ways depending on
> size — small files went straight to S3 in one request, large files got
> split into chunks and uploaded sequentially to a Telegram-backed storage
> layer. Users reported that large-file uploads would fail partway through
> with a generic "chunk failed after 3 attempts" error. I traced it to the
> app's short-lived session token (15 minutes) never being refreshed
> proactively anywhere in the client — once it expired mid-upload, every
> remaining chunk request came back as a plain "unauthorized," the retry
> logic exhausted its 3 attempts against the same dead token, and the
> upload just died with no recovery path.

---

**Q: What was the actual root cause, mechanically?**

> The app used two cookies: a short-lived access token (15 minutes) that
> every API route checks, and a longer-lived refresh token used to mint a
> new one. Refreshing was implemented correctly as a function — but that
> function was only ever called once, right when the page first loaded.
> Nothing repeated it in the background. So 15 minutes after page load (or
> after the last login), the access token silently went stale, and every
> API call from that point on got rejected — not just uploads, anything.
> Large uploads exposed it because they're the one operation on the page
> that plausibly runs long enough, or starts late enough in a session, to
> cross that 15-minute line.

---

**Q: How did you confirm that was really the cause, instead of guessing
from reading the code?**

> I didn't want to hand back a theory, so I reproduced it end-to-end
> against the actual running app. First I ruled out the obvious "boring"
> explanations: I drove a full large-file upload through the real backend —
> twice, once in each of its two encryption modes — and both completed
> successfully, which ruled out the storage backend, the network, and the
> credentials it used as the cause. Then I specifically corrupted the
> session's access token mid-flow, the way it would look right after a
> natural 15-minute expiry, and sent the exact same chunk request the
> client sends. It came back with the exact failure signature reported:
> an unauthorized response carrying none of the metadata the client relies
> on to trigger its fallback path. That's what turned "I think this is the
> cause" into "I know this is the cause" before I touched a single line of
> the fix.

---

**Q: Why did this only show up for files over a certain size, and not
small ones?**

> Because the two upload paths have completely different shapes in time.
> A small file goes to storage in a single request that finishes in well
> under a second — it can never live long enough to hit a 15-minute wall.
> A large file is split into many sequential chunk uploads, and depending
> on file size and connection speed that whole sequence can easily run
> long — or the token can simply already be close to stale if the person
> had the tab open for a while before starting the upload at all. The
> large-file path was the only one with enough elapsed time in it for the
> bug to become visible.

---

**Q: Once you knew the cause, why did you fix it the way you did instead
of something else?**

> I looked for the smallest change that closed the actual gap rather than
> restructuring how sessions worked. The refresh function itself was
> already correct and already safe to call repeatedly — it just wasn't
> being called on a schedule. So the fix was to call that same function
> automatically, on an interval comfortably shorter than the token's
> lifetime, for as long as the user stays on the page. That reuses code
> that had already been reasoned about carefully (in an earlier, unrelated
> security review of this same session system) instead of introducing a
> new mechanism that would need its own review.

---

**Q: Is there anything not fully solved by that fix — what would you do
next if you had more time?**

> Yes — it shrinks the failure window from "guaranteed, every long
> upload" to "only the rare upload that happens to straddle the exact
> refresh interval," but it doesn't make it structurally impossible. A more
> thorough fix would be a shared request wrapper that catches an
> unauthorized response on *any* call, transparently refreshes, and retries
> that one request — rather than relying on a fixed timer to always win the
> race. I flagged that as a deliberate follow-up rather than building it in
> this pass, since the interval fix already closes the reported, reproducible
> case, and a request-wrapper touches every network call site in the app —
> a bigger, riskier change for a much smaller remaining slice of risk.

---

**Q: How does this connect to other session/auth bugs you've dealt with in
this same app?**

> It's the same *family* of mistake as a session-bridging bug I'd fixed
> earlier in the same codebase, even though the symptom looked completely
> different — uploads failing versus users landing in the wrong account.
> Both came from the same root habit: a piece of session state that's
> supposed to stay in sync with reality, but is only ever updated at one
> specific moment instead of being actively maintained. In the earlier bug
> that caused *incorrect* trust; in this one it caused *premature*
> distrust. It reinforced a general lesson I now apply to any session
> system: enumerate every place credential state can go stale, and check
> that each one has something actively keeping it current — not just an
> initial setup step.

---

**Q: Walk me through your testing process for something like this — you
can't exactly wait 15 minutes in production.**

> I didn't need to wait — I reproduced the *end state* directly instead of
> the passage of time. Since the bug is really "what happens when this one
> cookie is invalid," I just made it invalid on demand — logged in for
> real, then overwrote that one cookie with garbage — and sent the same
> request the app would send 15 minutes later. That gave me the exact
> failure instantly and repeatably, without waiting on a clock or needing
> to simulate a slow network. I also cleaned up every artifact the test run
> created — a throwaway account, its test file records, and the dummy
> messages it posted to the backing storage channel — since testing
> against a real environment shouldn't leave debris behind.

---

## Notes on delivery

- Open with the user-facing symptom ("uploads fail"), not the token
  lifecycle — get to "why does size matter" before "here's the cookie
  expiry mechanism."
- The strongest signal in this story is the reproduction discipline: ruling
  out the storage backend *before* touching the session theory, then
  forcing the exact end-state instead of waiting on a timer. Interviewers
  respond well to "I made the bug happen on demand" over "I read the code
  and it looked wrong."
- If pushed deeper technically, be ready to explain *why* a fixed-interval
  refresh is safe here specifically (it renews a session's own,
  already-verified credential) versus the earlier bug's mistake (minting a
  session from someone else's ambient, unverified one) — the distinction
  is what stops this fix from reintroducing the earlier bug's shape.
