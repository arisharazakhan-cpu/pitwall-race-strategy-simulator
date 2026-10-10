# PitWall model card

## Purpose

PitWall is an educational race-strategy simulator. It demonstrates probabilistic modeling, temporal backtesting, explainability, event-driven interfaces, and resilient data ingestion. It does not reproduce a Formula 1 team's proprietary model and must not be used for safety-critical decisions.

## Inputs

- Driver position, tyre compound and tyre age
- Remaining laps and pit-loss estimate
- Circuit traffic and overtaking coefficients
- Weather state and safety-car prior
- Pit timing and driver pace command

## Reproducibility

Each playable mission exposes a fixed integer seed. Random-looking opponent movement and pit-stop variance derive from that seed and lap index. Replaying the same scenario with the same actions therefore produces the same modeled disturbances.

## Mission scoring

| Category | Maximum |
| --- | ---: |
| Final position | 35 |
| Tyre selection | 20 |
| Pit timing | 20 |
| Pace management | 10 |
| Risk management | 10 |
| Reaction time | 5 |

A mission cannot pass unless its explicit finishing-position objective is achieved. Failed missions are capped at 69/100 so the rating cannot contradict the outcome.

## Monte Carlo output

The strategy engine returns expected finishing position, expected time delta, podium and win probabilities, an 80% interval, competitor-response probability, and weather risk. The 100,000-path browser stress test executes ten 10,000-path batches and reports convergence between batches.

## Limitations

- Circuit coefficients are illustrative rather than team-calibrated.
- The playable mission uses a simplified field and discrete lap transitions.
- Aerodynamics, fuel burn, energy deployment, tyre temperature, and driver-specific skill are abstracted into pace and traffic effects.
- Historical OpenF1 coverage and rate limits can affect backtest availability.
- A correct simulated recommendation does not imply a real-world strategy guarantee.
