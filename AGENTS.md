# Agent notes

Read this file first. It is committed, so it is the only guidance that survives a
fresh checkout. If a local rules directory exists in your workspace (`.cursor/rules/`
or similar), read that too — it stays local because it carries private planning
links. If it does not exist, nothing in it is required to do good work here;
everything load-bearing is below.

> TODO: If this repository is public, say so on the first line and add:
> "Assume every file is world-readable."

## Start here

```bash
# TODO: the bootstrap command(s) that install every toolchain this repo needs
```

Run bootstrap again after any checkout that changes a manifest
(`package.json`, `pyproject.toml`, `go.mod`, …). **Checking out a branch does not
install what that branch added** — a missing dependency surfaces as
`ModuleNotFoundError`, `ERR_MODULE_NOT_FOUND`, or an unresolved import on a
command that worked yesterday.

> TODO: If entry points must run through a specific interpreter, venv, or
> container, write the exact invocation here and say never to use the bare
> system one. Read the manifest for script names rather than guessing them.

## Testing, and what "tests pass" is worth

**Do not assume the top-level test command runs everything.** Write out the map
once, here, and keep it current:

| command | covers |
|---|---|
| `TODO` | TODO — and say which suites it does *not* reach |
| `TODO` | TODO — mark the ones needing a live database, network, or credentials |

Use the narrow command when you are checking one fact. Run the broad set before
claiming a change is verified.

**A command that prints nothing on success is indistinguishable from one that
never ran.** Say so rather than quoting empty output. If you need to prove it is
not a no-op, insert a deliberate error once and show the failure.

**CI runs some suites, not all of them.** Read the workflow files and name here
which jobs actually run on a pull request. Counts for suites CI does not run are
self-reported, and should be labelled that way.

**Capture whole streams to a file.** Test runners commonly write their summary to
unbuffered stderr while other output is pipe-buffered, so a `tail` of a mixed
stream can cut the line you are quoting. Never quote a `tail`, `head`, or `grep`
excerpt as evidence for a count or an exit status.

## Checks that cannot fail

These share one mechanism: the subject of the check is derived from the act of
checking, so the check confirms itself, passes, and is then quoted as evidence.

- **An assertion that has not been shown to fail has not been shown to work.**
  Run it against a known-bad input — the old value, the broken path, a deliberate
  type error — and watch it fail before you trust the pass. An assertion that
  holds on both sides of a change is measuring neither side, and a normalised
  path or a shared default is enough to make two different things compare equal.
- **Never `pgrep -f` a pattern you just typed.** The pattern is in the argv of the
  process doing the search, so it matches itself and reports the thing it was sent
  to find, running or not. `ps -eo pid,args | grep …` fails the same way — `ps`
  lists the `grep`. Check for the service rather than for the string: probe its
  port with `/dev/tcp`, read a pidfile, or match the executable with `pgrep -x`,
  which compares the process name and not the command line.
- **Never read an exit status through a pipe.** `$?` after `cmd | head` is head's
  status, and head succeeds almost unconditionally. Capture the output to a file
  first, read `${PIPESTATUS[0]}`, or set `pipefail` so the pipeline carries the
  failure.
- **Quote the exact command beside any negative result.** A "this appears nowhere
  else" is a claim about your search tool as much as about the repository. Prefer
  `git grep` over `grep -r` where ignore files are in play, and escape regex
  metacharacters — an unescaped `0.5.1` matches `0x5y1`.

## Before you change a shared value

Values duplicated by hand across layers, with nothing comparing them, let one copy
be wrong while every suite is green. Before changing any value that also appears
in a fixture, an enum, a constant, a migration, or a doc, search the whole repo
for it and list every copy you find in the pull request — including the ones you
did not change.

> TODO: list the known duplicated families here, each with its owners, as you
> find them. A ticket's count of where a value lives is a hint, not a bound.

**Fixing some of the copies is worse than fixing none**, because the suite goes
green and the survivor becomes invisible. When you fix a duplicate, add a test
that compares the copies field for field, and name in the pull request any field
that genuinely cannot be compared.

A narrower set than the declared type is legal in most type systems and in most
CHECK constraints, so nothing fails until runtime. Prefer deriving one list from
another over maintaining two.

**When duplication is justified, reconcile against the source, not against the
other copy.** A parity test that skips when its dependency is missing passes for
the same reason a broken one does — fail instead of skipping.

## What breaks here most often

> TODO: two or three paragraphs on the failure modes that actually matter for
> *this* product — what a wrong-but-plausible output costs, and who pays. Name
> the distinction between "our code broke" and "the thing we are measuring
> broke", if the product has one. Any code that turns *we could not find out*
> into *it failed* is a defect, however reasonable the default looks.

What follows are defect classes that ship in most codebases. Check your own diff
against them before opening a pull request, and check the diff in front of you
when you review one.

**1. Hand-duplicated values.** See the section above. Fixing some of the copies is
worse than fixing none.

**2. Fail-open guards.** For any code whose job is to refuse, abort, verify or
gate, check the path where the guard's own dependency raises rather than returns
false. A gate that handles a negative return but not an exception does not gate.
This is the most missed class, because the happy path and the refusal path both
get tests while the *guard broke* path gets none.

Flag any `except Exception: return None`, or `?? false`, that collapses several
distinct failure modes into one value a caller then interprets.

**3. Silent defaults standing in for unmeasured values.** A defaulted value
rendered identically to a measured one is how a fabricated number reaches a page.
Absence needs its own visible state — never a result colour, never a plausible
fallback string.

**4. Assertions that check shape, not substance.** `length > 0`, `is not None`,
"events arrived", "a row exists" — none of these prove the content is right. An
assertion has to name the field it checks and the value it expects.

**5. Two numbers derived from different populations.** When two figures appear in
one cell, one row, or two adjacent boxes, check they come from one read over one
population. A mean of `[88]` beside a mean of `[74, 60, 28]` is two true numbers
and one false impression.

**6. Reads that fold over a possibly-truncated page.** Any *newest per key* fold
over an unpaged query is a correctness bug rather than a performance one: an older
row renders as the latest and the page still looks complete. Check `.limit()`,
pagination, and whether the fold happens in the database or in application code.

## Scope fences

Where tickets fence files that another open pull request owns, respect the fence —
parallel lanes merge many pull requests a day and a cross-lane edit costs a
conflict.

**A fence does not make the bug stop existing.** When a fence blocks the actual
fix, put it under its own heading in the pull request body:

```markdown
## Found, not fixed

`path/to/file.ts:469` reads the wrong field for X; the correct value is in Y.
One-line change, fenced by <ticket>.
```

File, line, the one-line change, and a test that fails until it lands. Not prose.
A flagged bug with no artifact gets re-flagged every round and shipped anyway.

**Two exceptions where you widen the diff instead**, saying plainly in the pull
request that you widened it and offering to drop the commit:

1. **The fenced file holds the defect the ticket is about.** Obeying the fence
   then ships an unfinished ticket with `Fixes` on it.
2. **The fenced file carries a false claim about a third party.** Scope discipline
   exists to stop refactors, not to keep an unsupported assertion in the product.

Before honouring a fence, check the paths exist on `origin/main` and any pull
request it names is still open. Stale fences protect nothing and cost a cycle.

## Verify a ticket before you build on it

Tickets are written before the merges that invalidate them. Check each factual
premise against the code — `git log origin/main`, `gh pr view <n> --json files`,
and reading the file — and report in the pull request which premises were stale.
Do not re-implement something already built, and do not stop on a blocking gate
that names a pull request which does not exist.

If a ticket prescribes an exact fix, check it compiles against the file's actual
scope before following it. A prescribed change that cannot work is better reported
than approximated.

## When `main` moves under you

Run `git status` and `git rev-parse HEAD` at the start of a turn and again before
committing. More than one agent may share a checkout, and a branch switch
mid-session discards uncommitted work.

After any rebase or force push:

- **Re-verify every behavioural claim in the pull request body against the new
  merge base.** Delete paragraphs that are no longer true. A body is written once
  and read as current; nothing re-checks it for you.
- **Re-check every `file:line` citation you have already published** and post
  corrections for the ones that moved.
- **Re-run the counts.** Every number in a body decays within hours.
- **Never reference a commit sha** in a body. A rebase rewrites all of them. Name
  the file and the symbol instead.

## Environment limits

Sessions differ. Some have Docker, some do not; some have credentials, some do not.

**Do not assert a limitation you have not tested.** Try to install the dependency
first. If you still cannot, say what you ran and what it printed.

State plainly, as a list in the pull request, which claims your environment could
not execute — no Docker, no network, no credentials, no preview branch. An
unverified claim reported the same way as a verified one makes the whole report
unusable. A skipped or usage-limited check is **not run**, never passing.

## Security

- Never commit secrets. Use `.env.example` for variable names only, with empty
  values.
- Never expose a server-only secret to the client — check the framework's
  public-prefix convention (`NEXT_PUBLIC_`, `VITE_`, …) before naming a variable.
- Redact secrets at the write boundary, before anything is stored — never filter
  them downstream. A control that depends on access rules, column grants, and a
  subscription layer all staying correct will fail the week one of them changes. A
  control that removes the secret before it is stored has nothing left to
  misconfigure.

> TODO: name the credentials this project holds and where each is allowed to go.

## Planning

> TODO: name the tracker and the convention. Read the issue before changing code.
> If tracker text is private, say here that ticket names, issue numbers, and
> private text must never be copied into files, comments, docs, commit messages,
> branch names, or pull request titles — and name the one place where the link
> does belong.

## Documentation

When product code changes, update docs in the same change.

- Update the root [README.md](README.md) in the same diff as the code, and any
  package-level README when that package changes
- Product purpose lives in [docs/VISION.md](docs/VISION.md); visual rules in
  `DESIGN.md`
- Comment functions and implementations: purpose, inputs, outputs, side effects
- Add new env var names to `.env.example` with empty values
- Public docs describe the product, not editor setup or private process

**When a doc is fenced to another lane, the fence wins.** Record the documentation
you could not write under `## Found, not fixed` and say which file needed it. Two
agents documenting the same file twelve minutes apart ships contradictory
statements.

`CLAUDE.md` describes the target design. Where it describes intent rather than what
the code does today, say so in the pull request rather than coding to the
description.

## Reviews

Review for secrets, hygiene, the documentation bar above, and a test plan the
reviewer can follow.

- **Reply on the thread the finding is on, and resolve it there.** A summary
  comment is additional, never the answer — unresolved threads make a fixed pull
  request read as open findings.
- **`resolved` is not evidence of `fixed`, and neither is the check rollup.**
  Review bots have been observed resolving threads when a new commit lands,
  whether or not that commit touched the finding, and inconsistently enough that
  thread state carries no information in either direction. A `NEUTRAL` rollup does
  not mean no review ran. **Read the threads, never the rollup.**
- **The in-thread reply is the record.** Name the commit that fixed it, in the
  thread. Say in the thread when you are deferring one, and why. A deferral under
  a green checkmark is worse than an open thread, because a reader infers a fix
  from the checkmark and never opens it.
- **Reproduce a finding before fixing it, and quote the measurement before
  refuting it.** Severity is not evidence. Findings split into a real half and a
  false half more often than not.
- **Re-request review after any push that changes the head sha**, rebases
  included. A review of an older sha is not a review of what is merging.
- **Do not overwrite a pull request body that contains a bot-generated section.**
  Append instead; overwriting pins a stale footer.
- Paginate the review API with `per_page=100` before asserting every thread is
  answered, and filter by author — `gh` authenticates as the repository owner, so
  your own replies look like new events.
- **If three consecutive rounds find a defect in the same file**, stop patching and
  report what the file's structure permits.

## Git

Always start from `main`. Before any new branch, `git fetch origin` and
`git pull --ff-only origin main`. Never branch from a stale local `main`. After a
branch or pull request is pushed, check out `main` again and pull so it matches
`origin/main`. Never commit on a feature branch unless you are updating an
existing pull request.

Branch names are free. Titles describe the change in plain language — no ticket
prefix.

> TODO: if the tracker links through the pull request body, state the exact
> closing line and when each form applies (completes the ticket vs. one of
> several).

Every pull request documents how to test the change. Put the steps under a
`## Test plan` heading — commands, URLs, and what success looks like — or update a
README in the same pull request with a How to test section a reviewer can follow,
and point at that heading from the body. Empty checkboxes and "TBD" do not count.

State a per-suite command next to each claim, and paste raw output. If a command
prints no count, say "this command prints no count" rather than supplying one.
