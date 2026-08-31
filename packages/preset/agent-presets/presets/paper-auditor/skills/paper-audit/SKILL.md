---
name: paper-audit
description: Audit an academic paper draft and its review — verify each claim against its cited primary source directly (ALIGNED / PARTIAL / DRIFT / UNCHECKED), check vocabulary consistency and citation format, judge whether the review missed or misjudged anything, and issue the machine-readable Verdict the loop parses. Adapted for the dsh paper loop from the MIT-licensed shimo4228 source-fidelity-checker, vocabulary-consistency-checker, and citation-formatter agents.
---

# Paper Audit

Audit the latest draft and the commenter's review. You check claim-to-source fidelity, vocabulary consistency, citation format, and the quality of the review itself. You end with a machine-readable Verdict section that the loop parses for convergence — keep its format exact.

## Part A: Source fidelity

Your central job: verify that each claim in the draft accurately reflects what its cited primary source actually says. Read the primary source directly — a local material file with the read tool, an external URL by fetching it. Do not infer a source's content from a summary, a progress note, or the proposal. If the claim cites a material file, read that file.

### Procedure

1. **Extract claim-cite pairs.** For each cited claim, record the claim sentence(s) and the cite pointer (material file, Author YEAR, URL). Multiple cites per claim list them all.
2. **Read the primary source directly.** Local file → read it. External URL / DOI / arXiv → fetch it. If the source is inaccessible (paywalled, offline, link rot), mark the pair UNCHECKED — do not guess.
3. **Classify each pair:**

| Verdict | Meaning |
|---|---|
| ALIGNED | The draft's claim faithfully reflects the source — the asserted fact, relationship, or definition is accurate (wording may differ stylistically) |
| PARTIAL | The draft paraphrases the source in a way that preserves meaning but loses nuance, a sub-classification, or a qualification — not necessarily drift, worth flagging |
| DRIFT | The draft's claim diverges from the source in a load-bearing way — the essence, sub-classification, direction of causation, or qualification has changed |
| UNCHECKED | Primary source not accessible |

4. **Diagnose each DRIFT** — where the draft says what, where the source says what, what changed (essence/consequence inversion, sub-classification dropped, qualification removed, direction reversed), and the likely cause (draft relied on a secondary file, or the secondary itself drifted).
5. **Propose modification direction** — do not modify anything yourself; list candidates in priority order:
   1. Fix the draft to match the primary source.
   2. Fix the secondary (summary/progress note) if it drifted, then re-derive the draft — so the next round does not reproduce the same drift.
   3. Fix the primary source itself only when the source is outdated and the author judges it needs revision (rare).

## Part B: Vocabulary consistency

Check that each term the draft introduces is defined once, used consistently, and carries its sub-classification at introduction.

- Inventory every named term (capitalized noun phrases used as labels, italicized novel terms, keywords-list terms). Record first occurrence, definition at first occurrence, sub-classification declared, and subsequent occurrences.
- **Definition at first occurrence** — the term is defined ("the X is Y"), not merely announced ("the X is important here").
- **Sub-classification introduced with the term** — if the source declares sub-forms / sub-types, they appear at introduction, not first surfacing in a later section.
- **Essence vs consequence** — the definition states the load-bearing essence; a derived consequence is a follow-up sentence, not the definition. Presenting a consequence as the essence lets a reader refute the term with a counter-example to the consequence.
- **Usage consistency** — each subsequent use aligns with the first-occurrence definition; a narrower/wider use is explicit; if the use applies to one sub-form only, that sub-form is named.

Classify findings: `MISSING_DEFINITION`, `MISSING_SUB_CLASSIFICATION`, `ESSENCE_CONSEQUENCE_INVERSION`, `USAGE_DRIFT`, `SUB_FORM_OMISSION`.

## Part C: Citation format

Check the citation infrastructure:

- **1-to-1 mapping.** Every in-text citation has a matching reference entry; every reference entry is cited at least once. Mismatches are orphan citations (in-text without reference, or reference without in-text use).
- **Format consistency.** One citation style throughout (APA-like simplified for preprints); per source type the required fields are present (author / year / title / venue / pages / DOI); author-name format is uniform; journal names italicized consistently.
- **Identifier validity.** DOI matches `10.\d{4,9}/.+`; arXiv ID matches the new `\d{4}.\d{4,5}` format; URLs carry scheme + host + path. Verify by fetch where possible; mark unverifiable IDs rather than assuming.

## Part D: Review-quality judgment

The commenter's review is also under audit. Judge whether it missed or misjudged anything:

- A Critical or High issue in the draft that the review did not flag at all.
- A dimension score that misreads the draft (e.g., near-perfect voice score on a draft with heavy slop, or a score inflated/deflated relative to the issues actually listed).
- An issue the review flagged that the draft does not actually have (a false positive — worth telling the commenter).
- Whether the review's issue priorities match the draft's real weaknesses.

Keep this channel distinct from the draft-feedback channel: it is feedback to the commenter, not more draft criticism.

## Output format

Return the audit with exactly this structure:

```
## Audit of draft N (and review N)

### Source fidelity summary
- ALIGNED: <N1>
- PARTIAL: <N2>
- DRIFT: <N3>
- UNCHECKED: <N4>

### DRIFT findings
- §N ¶M: <claim> → <source says> → <what changed, likely cause, modification direction>

### Vocabulary findings
- <MISSING_DEFINITION | MISSING_SUB_CLASSIFICATION | ESSENCE_CONSEQUENCE_INVERSION | USAGE_DRIFT | SUB_FORM_OMISSION>: <term> §N ¶M — <finding, what to change>

### Citation findings
- §N ¶M: <orphan in-text / orphan reference / style inconsistency / invalid identifier> — <finding, what to change>

### Feedback to the writer
- <the draft issues the writer must fix, prioritized>

### Feedback to the commenter
- <what the review missed, misjudged, or falsely flagged>

## Verdict
Result: <PASS | FAIL>
Score: <0-100>
Critical count: <0-N>
```

## Verdict rules

- `Result: FAIL` if there is any DRIFT finding, any Critical-count finding, any orphan citation or identifier that fails validation, or any Critical issue in the feedback channels. `Result: PASS` only when nothing above blocks.
- `Score` is the audit's overall quality judgment of the draft (0-100). Be honest — an 80+ score means the draft is genuinely close to final.
- `Critical count` is the number of findings that must be fixed before the loop converges — DRIFT findings, orphan citations, failed identifiers, and Critical issues combined. Zero is the requirement for PASS at the default threshold.

Keep the Verdict section machine-readable: `Result:` line is exactly `PASS` or `FAIL`, `Score:` is an integer 0-100, `Critical count:` is an integer. No prose inside those three lines.
