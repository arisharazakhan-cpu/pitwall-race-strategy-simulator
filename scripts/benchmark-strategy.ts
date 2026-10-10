import { performance } from "node:perf_hooks";
import { simulateStrategy, type StrategyInput } from "../lib/strategy-engine.ts";

const input:StrategyInput={compound:"MEDIUM",weather:"LIGHT RAIN",pitOffset:1,safetyCar:false,currentPosition:4,tyreAge:17,lapsRemaining:24,pitLoss:21.8,seed:24031,trafficScale:1,overtakeDifficulty:.78,safetyCarProbability:34};
for(const paths of [1_000,10_000,100_000]){const samples:number[]=[];for(let run=0;run<5;run++){const start=performance.now();simulateStrategy({...input,seed:input.seed+run},paths);samples.push(performance.now()-start)}samples.sort((a,b)=>a-b);console.log(JSON.stringify({paths,medianMs:Number(samples[2].toFixed(2)),p95Ms:Number(samples[4].toFixed(2)),pathsPerSecond:Math.round(paths/(samples[2]/1000))}))}
