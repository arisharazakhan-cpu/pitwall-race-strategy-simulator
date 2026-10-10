# PitWall threat model

## Protected assets

- Trusted lap-aligned race snapshots
- Strategy inputs and Monte Carlo outputs
- Availability of the race-operations dashboard
- Integrity of the strategy decision history

## Trust boundaries

1. **OpenF1 → edge API:** upstream telemetry is untrusted until its response shape, session identifiers, timestamps, and numeric ranges pass validation.
2. **Edge API → snapshot model:** raw records cannot directly replace the last verified snapshot.
3. **Snapshot model → strategy engine:** only normalized, lap-aligned state is accepted as model input.
4. **Browser → edge API:** race query parameters are length-, format-, and character-validated before upstream requests are constructed.

## Abuse cases and controls

| Threat | Risk | Implemented control |
| --- | --- | --- |
| Malformed upstream payload | Corrupts positions or strategy inputs | Array/schema checks and fail-closed response handling |
| Impossible telemetry value | Produces an unsafe recommendation | Range/invariant validation and quarantine counter |
| Duplicate or replayed event | Applies one state transition repeatedly | Idempotency-key deduplication |
| Slow or unavailable upstream | Freezes the decision surface | Request timeout, circuit state, edge caching, stale-while-revalidate |
| Unbounded query input | Enables cache abuse or injection | Strict year/country validation and URL encoding |
| Client-side secret exposure | Leaks credentials | No API credentials or private configuration shipped to the browser |
| Supply-chain regression | Introduces vulnerable code | Locked dependencies, automated build, CodeQL, and Dependabot review |

## Failure-lab scope

The failure lab is intentionally isolated from external systems. It changes the simulator's pipeline state and audit record without attacking OpenF1 or transmitting synthetic traffic outside PitWall. This makes resilience behavior safe and reproducible during portfolio demonstrations.
