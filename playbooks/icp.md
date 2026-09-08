# Ideal Customer Profile — scoring rubric

rubric_version: v1

You score leads against this rubric. Output an integer 0–100, a tier, and a
rationale that cites the specific evidence you used. If evidence for a criterion
is missing, award 0 for it and say so in the rationale — never guess to fill a gap.

## Weighted criteria (total 100)

| Criterion | Weight | What earns full marks |
|---|---|---|
| Service fit | 25 | Their stated need maps directly onto a service in `services.md` |
| Budget signal | 20 | Evidence they can afford our floor price (headcount, funding, current vendors, ad spend) |
| Company size | 15 | 10–250 employees. Under 10 rarely has budget; over 250 has procurement friction |
| Decision-maker access | 15 | The contact is a founder, C-level, or department head — not an intern or a generic inbox |
| Urgency / trigger | 15 | A recent event implies a live need: new funding, new hire in a relevant role, a launch, a rebrand, visible gaps |
| Industry match | 10 | An industry we have shipped comparable work in |

## Tiers

- **A — 75+**: pursue now. Worth a personalised first touch.
- **B — 55–74**: pursue with a lighter-touch sequence.
- **C — 35–54**: nurture only. Do not spend a human hour here.
- **D — under 35, or any disqualifier**: do not contact.

## Hard disqualifiers

Any one of these forces tier D regardless of score. List every one you find in
`disqualifiers`.

- Generic role inbox only (`info@`, `contact@`, `hello@`) with no named contact
- A direct competitor of ours or of an existing client
- Explicitly asked not to be contacted, or already on the suppression list
- Company appears defunct: dead site, no activity in 12+ months
- Requires services we do not offer and will not subcontract
- Located in a jurisdiction we cannot legally invoice

## TODO for the agency

Replace the weights, size bands, industries, and disqualifiers with your real
ones. Bump `rubric_version` on every change — it is recorded against every score
so you can tell which rubric produced which decision.
