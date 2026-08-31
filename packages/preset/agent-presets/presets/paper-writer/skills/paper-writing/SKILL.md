---
name: paper-writing
description: Draft an academic paper from the topic's input materials — build the primary-source list, map each claim to a cite 1:1, preserve sub-classifications, and draft in the artifact-centric academic voice. Adapted for the dsh paper loop from the MIT-licensed shimo4228 paper-writing skill.
---

# Paper Writing

Draft the paper from the topic's input materials, grounding every claim in a cited primary source. The materials under the topic's `input/` (`proposal.md`, `introduction.md`, `progress.md`, and `materials/`) are the working sources for this draft.

## Pre-draft checklist

Before writing, settle the claim-to-source mapping:

1. **Primary source list.** Inventory the sources this draft will cite: input material files, external papers (Author YEAR + arXiv ID / DOI), standards or framework docs (Org YEAR + standard ID). Each source must be readable now — a local file, a fetchable URL, or a pasted excerpt. Never cite a source you have not read.
2. **Avoid secondary reliance.** Do not build a claim on a summary, glossary, or progress note that paraphrases the real source. Secondary files describe where a source lives; the claim itself must come from the primary source. Write claims directly against the material, not against someone's restatement of it.
3. **Claim ↔ cite, 1:1.** For each section, write the core claim in one sentence, then pair it with the exact cite that supports it. A claim with an ambiguous or missing cite does not go into the draft. When a claim is your own synthesis or judgment (not sourced), say so explicitly ("this paper argues…", "the framework records…") instead of attaching a cite it does not rest on.
4. **Preserve sub-classifications.** If a source distinguishes sub-forms, sub-types, or sub-cases of a concept, introduce that sub-classification in the draft at the point the term is introduced. Flattening a source's sub-classification down to its essence is drift.

## Section structure

Use the structure that fits the paper; a position-paper layout is:

1. Title page — title, subtitle, version, companion repository
2. Abstract — 3 paragraphs: problem → contributions → consequence, 250-300 words, with 5-8 keywords below
3. Introduction — problem statement, thesis preview, roadmap
4. Body sections — the core contribution, 3-6 sections
5. Relationship to existing frameworks — short, with the alternatives addressed in a dedicated location
6. Conclusion — thesis reprise plus open questions stated *as questions*, no new claims
7. References — one citation style, consistent throughout (APA-like simplified for preprints)

## Writing process per section

1. Restate the section's claim in one sentence (from the checklist).
2. Open with the concrete: an example, a known phenomenon, or the cited source — not abstract framing.
3. Place the evidence that supports the claim immediately after it, cite 1:1.
4. End the section with an explicit handoff: what the next section takes as premise, what open question it receives. Filler transitions ("Moreover", "Furthermore") are not handoffs.
5. Keep subordinate paragraphs aligned in one direction — either decomposing the claim or treating a counter-argument. Mixing both in one section weakens the flow.

## Academic voice

- **Minimize first-person singular.** Prefer artifact-centric voice: "The paper introduces…", "This section argues…", "The framework records…". Reserve "I" for venues whose house style permits it.
- **Evidence 1:1 for every claim.** A claim without a cite, a labeled-own-observation marker, or an experimental marker is a flag.
- **Positive over negative form.** Prefer "X belongs in Y" over "don't build X". Keep the reader knowing what to do next.
- **Hedge proportionately.** Reduce triple hedges ("it might possibly be the case that…") to one. Do not over-claim beyond the evidence ("This proves X" when the evidence only supports it) and do not under-claim when evidence fully supports the claim.
- **Mark experimental status.** Unsettled judgments are explicitly "experimental" or "open question"; the boundary between settled and experimental claims stays visible in the draft.
- **No banned generic phrases.** Avoid "in today's rapidly evolving landscape", "revolutionary", "paradigm shift", "cutting-edge", "seamless", "powerful", and similar empty intensifiers.

## Reader clarity

Write for a first-time academic reader who knows the field but nothing of the companion repository, the author's prior work, or the writing process. The paper must stand alone:

- **Coined-term budget.** Introduce a named term only when existing vocabulary cannot say it in one plain sentence. Exempt from the budget: concepts the title promises, proper names of cited frameworks/systems, and field-standard vocabulary. A term used fewer than ~3 times becomes a plain phrase.
- **Title-axis carry-through.** The contrast the title promises appears in the thesis statement — ideally in its main verbs and subjects, not buried in modifiers — and each load-bearing section argues in the title's vocabulary. If body and title vocabulary diverge, fix the body toward the title.
- **No editorial meta-commentary.** Do not narrate the writing process ("derived, not coined", "named here to keep X visible", "the concession comes first because…"). Keep required hedges that bind claim strength ("not offered as a formal proof", "to the author's knowledge") — clarity rules never strip those.
- **No insider dependency.** No paragraph requires knowing the repo structure, a sibling project, or an internal glossary. Internal cites corroborate but never substitute for an in-text explanation; a name with no referent outside the repo gets a one-line gloss at first use.
- **One-sentence test.** A reader who reads each section once can state its point in one plain sentence; a reader of the abstract alone can say what the paper claims and what is new.

## Self-check before finishing the draft

- Every claim has a cite, a labeled-own-observation marker, or an experimental marker.
- Every cited source was actually read, and the draft reflects its content (no secondary-derived claims).
- Sub-classifications from sources are introduced with their terms, not flattened.
- The abstract's announced contributions all have corresponding body sections.
- The draft passes the reader-clarity checks above.

The commenter and auditor will check the same standards independently; a draft that already passes this self-check converges faster.
