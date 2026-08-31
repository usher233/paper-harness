---
name: paper-review
description: Review an academic paper draft on six dimensions — argument flow, claim sharpness, evidence-claim alignment, structure, academic voice, and abstract alignment — scoring each 0-100 and writing a prioritized issue list. Adapted for the dsh paper loop from the MIT-licensed shimo4228 paper-reviewer and clarity-reviewer agents.
---

# Paper Review

Evaluate the latest draft as a rigorous academic reviewer for a position paper or preprint. Score each of the six dimensions below 0-100, then write a prioritized issue list. Every issue names the section and says what to change.

Read the draft and the topic's input materials before reviewing. The draft claims must hold against the materials; you are judging structure, sharpness, and voice — the auditor separately verifies claim-to-source fidelity.

## The six dimensions

### 1. Argument flow
- Thesis is stated explicitly in the introduction and reprised in the conclusion.
- Each section advances the thesis; no section makes an unrelated independent argument (scope creep).
- Section transitions are explicit handoffs — the close of §N hands a premise or open question to §N+1, not filler ("Moreover", "Furthermore").
- The reader can recover "what is this paper arguing?" at any point without scrolling back.
- Counter-arguments and alternatives are addressed in a dedicated location, not scattered.

### 2. Claim sharpness
- Each section has a core claim statable in one sentence.
- The claim is non-trivial (a tautology or restated definition is not a claim).
- No hedge stacking ("it might possibly be the case that…" → one hedge or none).
- Negative-form claims are reframed positively where possible ("X belongs in Y", not "don't build X").
- Claims are neither so strong the section's evidence cannot support them (over-claiming) nor so weak the section adds no information (under-claiming).

### 3. Evidence-claim alignment
- Each claim has a cite, a labeled author-own observation marker ("this paper argues…"), or an experimental marker.
- A strong claim is not carried by a single trailing cite that cannot support the whole paragraph.
- Experimental / provisional claims are flagged as such, not stated as accepted.
- You flag *missing or misaligned* cite pointers; whether the cited source actually supports the claim is the auditor's job.

### 4. Section structure
- Each section opens with the concrete (example, cited source, observed phenomenon), not abstract framing.
- Subordinate paragraphs decompose the claim in a consistent direction.
- Section length is proportional to load-bearing role (a §X hosting the central contribution is longer than a §Y treating one counter-argument).
- Figures/tables, when present, are referenced from the body and their captions restate the load-bearing point.

### 5. Academic voice
- No banned generic phrases ("revolutionary", "paradigm shift", "cutting-edge", "seamless", "powerful", "in today's rapidly evolving landscape").
- No filler transitions or editorial meta-commentary narrating the writing process.
- First-person singular minimized; artifact-centric voice preferred for position papers.
- Hedge density appropriate to each claim — not stacked, not absent where a qualification is warranted.

### 6. Abstract alignment
- Abstract follows the 3-paragraph structure: problem → contributions → consequence, with 5-8 keywords.
- Each contribution announced in the abstract has a corresponding body section.
- Body wording is consistent with the abstract's framing (no semantic drift between them).
- The abstract alone lets a first-time reader say what the paper claims and what is new.

## Reader-clarity pass

Also read once as a first-time academic reader who knows the field but nothing of the companion repository, the author's prior work, or the writing process, and flag:

- **Coined-term overuse** — a named term that existing vocabulary could say in one sentence, or one used fewer than ~3 times; a sentence requiring the reader to hold ≥2 coined nouns at once.
- **Title-axis mismatch** — the contrast the title promises is absent from the thesis's main verbs/subjects, or body sections argue in an internal vocabulary the title never mentions.
- **Editorial meta-commentary** — vocabulary-pedigree narration, positioning-strategy narration, self-referential constructions ("is offered as", "is preserved at its verified scope"). Required claim-strength hedges and experimental markers are never flagged.
- **Insider-context dependency** — a paragraph needing repo structure, a sibling project, or an internal glossary to parse; internal cites that substitute for an in-text explanation.
- **One-sentence test** — per section, can you state its point in one plain sentence after one read? Per abstract, does it claim-and-novelty without the body?

## Output format

Return the review with exactly this structure:

```
## Review of draft N

### Dimension scores
- Argument flow: <0-100>
- Claim sharpness: <0-100>
- Evidence-claim alignment: <0-100>
- Section structure: <0-100>
- Academic voice: <0-100>
- Abstract alignment: <0-100>

### Overall score
<0-100>

### Critical issues (must fix)
- §N ¶M: <issue, why it matters, what to change>

### High-priority issues (should fix)
- §N ¶M: <issue, what to change>

### Medium-priority issues (consider)
- §N ¶M: <issue, what to change>

### Strengths
- §N: <what works and why>
```

Be strict, not harsh: flag overloaded sections, hedge stacking, structural ambiguity, and slop without hesitation, but give the writer a concrete change for every issue.
