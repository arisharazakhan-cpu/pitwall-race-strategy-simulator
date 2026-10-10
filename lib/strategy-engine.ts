export type StrategyCompound = "SOFT" | "MEDIUM" | "HARD" | "INTER";
export type StrategyWeather = "DRY" | "LIGHT RAIN" | "HEAVY RAIN";

export interface StrategyInput {
  compound: StrategyCompound;
  weather: StrategyWeather;
  pitOffset: number;
  safetyCar: boolean;
  currentPosition: number;
  tyreAge: number;
  lapsRemaining: number;
  pitLoss: number;
  seed: number;
  trafficScale?: number;
  overtakeDifficulty?: number;
  safetyCarProbability?: number;
}

export interface StrategyResult {
  expectedPosition: number;
  expectedDelta: number;
  confidence: number;
  podiumProbability: number;
  winProbability: number;
  p10: number;
  p90: number;
  bestMode: "UNDERCUT" | "OVERCUT" | "HOLD";
  competitorResponse: number;
  weatherRisk: number;
}

export interface StrategyContribution {
  key: "TYRE" | "DEGRADATION" | "PIT LOSS" | "TRAFFIC" | "WEATHER" | "SAFETY CAR";
  label: string;
  seconds: number;
  favorable: boolean;
  explanation: string;
}

function rng(seed: number) {
  let value = seed || 1;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function gaussian(random: () => number) {
  const u = Math.max(random(), 1e-9), v = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function simulateStrategy(input: StrategyInput, iterations = 1000): StrategyResult {
  const random = rng(input.seed + input.currentPosition * 97 + input.pitOffset * 13);
  const dryPace = input.weather === "DRY" ? { SOFT: -0.42, MEDIUM: -0.18, HARD: 0.05, INTER: 1.9 }[input.compound] : input.compound === "INTER" ? -0.28 : {SOFT:.62,MEDIUM:.48,HARD:.38}[input.compound];
  const degradation = { SOFT: 0.105, MEDIUM: 0.058, HARD: 0.032, INTER: 0.075 }[input.compound];
  const wetFit = input.weather === "DRY" ? (input.compound === "INTER" ? 7.5 : 0) : input.compound === "INTER" ? -3.8 : input.weather === "HEAVY RAIN" ? 11.5 : 4.5;
  const results: { delta: number; position: number }[] = [];

  for (let i = 0; i < iterations; i++) {
    const traffic = gaussian(random) * 2.4 * (input.trafficScale ?? 1) + (input.overtakeDifficulty ?? 1) * 0.32;
    const stopVariance = gaussian(random) * 0.65;
    const rivalPace = gaussian(random) * 3.2;
    const weatherShock = random() < (input.weather === "DRY" ? 0.08 : 0.28) ? gaussian(random) * 4.5 : 0;
    const response = random() < 0.62 ? Math.max(0, 1.1 - input.pitOffset * 0.3) : -0.5;
    const incidentalSafetyCar = !input.safetyCar && random() < (input.safetyCarProbability ?? 0) * 0.01;
    const effectivePitLoss = input.safetyCar || incidentalSafetyCar ? input.pitLoss * 0.56 : input.pitLoss;
    const horizon = Math.min(input.lapsRemaining, 14);
    const oldTyrePenalty = Math.max(0, input.tyreAge - 12) * 0.045 * Math.min(input.pitOffset + 1, 5);
    const tyreEffect = dryPace * horizon + degradation * horizon * horizon * 0.24;
    const timing = Math.abs(input.pitOffset - 1) * 0.75;
    const delta = effectivePitLoss - input.pitLoss + tyreEffect + wetFit + timing + traffic + stopVariance + weatherShock + response - oldTyrePenalty;
    const competitiveDelta = delta + rivalPace;
    const placeSwing = Math.max(-3, Math.min(3, Math.round(-competitiveDelta / 5.5 + gaussian(random) * 0.45)));
    results.push({ delta, position: Math.max(1, Math.min(20, input.currentPosition - placeSwing)) });
  }

  results.sort((a, b) => a.delta - b.delta);
  const meanDelta = results.reduce((sum, item) => sum + item.delta, 0) / results.length;
  const meanPosition = results.reduce((sum, item) => sum + item.position, 0) / results.length;
  const podium = results.filter(item => item.position <= 3).length / results.length;
  const wins = results.filter(item => item.position === 1).length / results.length;
  const spread = results[Math.floor(results.length * 0.9)].delta - results[Math.floor(results.length * 0.1)].delta;

  return {
    expectedPosition: Math.max(1, Math.round(meanPosition)), expectedDelta: meanDelta,
    confidence: Math.round(Math.max(52, Math.min(88, 92 - spread * 1.75))), podiumProbability: Math.round(podium * 100),
    winProbability: Math.round(wins * 100), p10: results[Math.floor(results.length * 0.1)].delta,
    p90: results[Math.floor(results.length * 0.9)].delta,
    bestMode: input.pitOffset <= 1 ? "UNDERCUT" : input.pitOffset >= 3 ? "OVERCUT" : "HOLD",
    competitorResponse: Math.round((0.72 - input.pitOffset * 0.07) * 100),
    weatherRisk: input.weather === "DRY" ? 12 : input.weather === "LIGHT RAIN" ? 46 : 73,
  };
}

export function explainStrategy(input: StrategyInput): StrategyContribution[] {
  const horizon = Math.min(input.lapsRemaining, 14);
  const dryPace = input.weather === "DRY" ? { SOFT: -0.42, MEDIUM: -0.18, HARD: 0.05, INTER: 1.9 }[input.compound] : input.compound === "INTER" ? -0.28 : {SOFT:.62,MEDIUM:.48,HARD:.38}[input.compound];
  const degradation = { SOFT: 0.105, MEDIUM: 0.058, HARD: 0.032, INTER: 0.075 }[input.compound];
  const tyre = dryPace * horizon;
  const deg = degradation * horizon * horizon * 0.24 - Math.max(0, input.tyreAge - 12) * 0.045 * Math.min(input.pitOffset + 1, 5);
  const timing = Math.abs(input.pitOffset - 1) * 0.75;
  const traffic = (input.trafficScale ?? 1) * (input.overtakeDifficulty ?? 1) * 0.78;
  const weather = input.weather === "DRY" ? (input.compound === "INTER" ? 7.5 : 0) : input.compound === "INTER" ? -3.8 : input.weather === "HEAVY RAIN" ? 11.5 : 4.5;
  const safety = input.safetyCar ? -input.pitLoss * 0.44 : -(input.safetyCarProbability ?? 0) * input.pitLoss * 0.0044;
  const make = (key:StrategyContribution["key"],label:string,seconds:number,explanation:string):StrategyContribution => ({key,label,seconds,favorable:seconds<0,explanation});
  return [
    make("TYRE","Fresh-tyre pace",tyre,`${input.compound.toLowerCase()} compound pace across the ${horizon}-lap evaluation horizon`),
    make("DEGRADATION","Tyre degradation",deg,"projected wear on the new set minus the cost of extending the current stint"),
    make("PIT LOSS","Pit timing",timing,`penalty for stopping ${Math.abs(input.pitOffset-1)} lap${Math.abs(input.pitOffset-1)===1?"":"s"} from the modeled optimum`),
    make("TRAFFIC","Traffic exposure",traffic,"circuit overtaking difficulty and expected rejoin traffic"),
    make("WEATHER","Weather fit",weather,`${input.compound.toLowerCase()} suitability for ${input.weather.toLowerCase()} conditions`),
    make("SAFETY CAR","Safety-car effect",safety,input.safetyCar?"reduced pit loss under the active safety car":"expected value of a possible neutralization"),
  ];
}
