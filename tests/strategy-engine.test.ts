import test from "node:test";
import assert from "node:assert/strict";
import { explainStrategy, simulateStrategy, type StrategyInput } from "../lib/strategy-engine.ts";

const base:StrategyInput={compound:"HARD",weather:"DRY",pitOffset:1,safetyCar:false,currentPosition:5,tyreAge:18,lapsRemaining:22,pitLoss:21.8,seed:42,trafficScale:1,overtakeDifficulty:.8,safetyCarProbability:0};

test("seeded simulations are deterministic",()=>assert.deepEqual(simulateStrategy(base,2500),simulateStrategy(base,2500)));
test("an active safety car reduces expected pit-loss delta",()=>assert.ok(simulateStrategy({...base,safetyCar:true},5000).expectedDelta<simulateStrategy(base,5000).expectedDelta));
test("intermediates outperform slicks in heavy rain",()=>assert.ok(simulateStrategy({...base,weather:"HEAVY RAIN",compound:"INTER"},5000).expectedDelta<simulateStrategy({...base,weather:"HEAVY RAIN",compound:"HARD"},5000).expectedDelta));
test("explanation covers all modeled decision factors",()=>assert.deepEqual(explainStrategy(base).map(item=>item.key),["TYRE","DEGRADATION","PIT LOSS","TRAFFIC","WEATHER","SAFETY CAR"]));
test("difficult circuits increase explained traffic cost",()=>{const fast=explainStrategy({...base,trafficScale:.8,overtakeDifficulty:.6}).find(item=>item.key==="TRAFFIC")!;const narrow=explainStrategy({...base,trafficScale:1.5,overtakeDifficulty:1.8}).find(item=>item.key==="TRAFFIC")!;assert.ok(narrow.seconds>fast.seconds)});
