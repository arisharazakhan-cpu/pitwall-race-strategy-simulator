# Strategy engine benchmarks

Measured locally with Node.js using five runs per sample size; the median and slowest observed run are reported. Results vary by host and are engineering measurements, not production latency guarantees.

| Monte Carlo paths | Median | Slowest of 5 | Throughput |
| ---: | ---: | ---: | ---: |
| 1,000 | 1.25 ms | 2.83 ms | 800,567 paths/s |
| 10,000 | 7.11 ms | 7.80 ms | 1,407,134 paths/s |
| 100,000 | 83.60 ms | 84.92 ms | 1,196,206 paths/s |

Reproduce with `pnpm benchmark`. The browser experience deliberately splits 100,000 paths into ten batches so progress and convergence can render between computations.
