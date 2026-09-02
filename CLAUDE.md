# TODO: project name

> TODO: two or three sentences. What this is, what it actually does, and what
> comes out the other end. Concrete verbs, no positioning language.

---

## Design

**Read `AGENTS.md` first.** It is committed, so it is the only guidance a fresh
checkout has: bootstrap, which suites the top-level test command does not run,
which suites CI runs and which counts stay self-reported, the shared-value
families, and the scope-fence convention. If a local rules directory exists in
your workspace, read that too — it stays local because it carries private
planning links.

**This file describes the target design.** Where it describes something the code
does not do yet, say so in your pull request rather than coding to the
description.

> TODO: if there is a design system, name the file to read before touching UI and
> the token file to import at the root. Never hardcode a colour, size, or border.
> Say where the working implementation lives and where the shapes live.

> TODO: if the same data exists in more than one place — fixtures, hardcoded test
> copies, generated artefacts — list every location here and say that nothing
> compares them automatically. Before changing a value that appears in any of
> them, search across all of them and list every copy found.

> TODO: search-tool caveats specific to this environment. If `grep` is aliased or
> wrapped, or if ignore files hide directories a recursive grep should reach, say
> so and name the command to use instead. A clean negative result from the wrong
> tool is a claim about the tool, not about the repository.

> TODO: tracker conventions that are easy to get wrong — which status names mean
> what, which transitions are yours to make and when. Reasoning from a status
> *name* goes wrong; name the API call that is the actual check.

---

## Stack

| Layer | Choice |
|---|---|
| TODO | TODO |
| TODO | TODO |

> TODO: for any dependency that is load-bearing in more than one place, say where
> and why — the reason it was chosen over the obvious alternative, in one line.

---

## Conventions

> TODO: the small decisions that must be consistent everywhere. Units and where
> they convert. Ordering that must never vary. Naming. What a record is and is not.
> Examples of the shape:
>
> - Durations are milliseconds in the database, `m:ss` in the UI.
> - <entity> always renders in order: A → B → C. Never omit one.
> - Every derived value cites the input that produced it.

---

## Rules that are easy to get wrong

> TODO: replace with this project's own. Each entry names a distinction that has
> actually been collapsed, or would be costly to collapse. Keep them specific
> enough to check a diff against.
>
> - **Distinguish "the subject failed" from "our code failed."** Get this wrong
>   and every result is suspect.
> - **Absence is a state, not a default.** A value we could not measure must never
>   render like one we did.
> - **A result you cannot trace to its input is a bug.**

---

## Writing for users

> TODO: the register. If this product publishes anything a person reads —
> messages, reports, generated text — say how it is written. The shape that
> works:
>
> - **Report, don't prosecute.** State what happened. The gap is the finding; no
>   adjective improves it
> - **Cite the source.** Every claim points at something that ran
> - **No editorial.** Not "unfortunately," not "this should be fixed"
> - **No performed empathy.** It reads as softening a blow, which implies a blow
>   was intended
> - **Short.** The person reading it is triaging
> - **Say it was generated**, and whether a human reviewed it
