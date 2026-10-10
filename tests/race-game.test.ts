import test from "node:test";import assert from "node:assert/strict";
import {analyzeDecision,missionByKey,placeChange,resultLabel,scoreMission,seededNoise} from "../lib/race-game.ts";
const mission=missionByKey("silverstone");
test("identical seeds reproduce identical noise",()=>assert.equal(seededNoise(42,7),seededNoise(42,7)));
test("P4 fails a podium mission",()=>{const score=scoreMission({mission,finishPosition:4,pitLap:34,selectedTyre:"INTER",paceMode:"BALANCED",reactionSeconds:2,completed:true});assert.equal(score.passed,false);assert.equal(resultLabel(score),"PODIUM MISSED");assert.ok(score.total<70)});
test("P2 to P4 reports two places lost",()=>assert.equal(placeChange(2,4),-2));
test("optimal wet stop earns full tyre and timing credit",()=>{const score=scoreMission({mission,finishPosition:2,pitLap:34,selectedTyre:"INTER",paceMode:"BALANCED",reactionSeconds:1,completed:true});assert.equal(score.tyreSelection,20);assert.equal(score.pitTiming,20);assert.equal(score.passed,true)});
test("reset seed is stable across a complete scenario",()=>assert.deepEqual(Array.from({length:20},(_,i)=>seededNoise(mission.seed,i)),Array.from({length:20},(_,i)=>seededNoise(mission.seed,i))));
test("post-race analysis identifies an off-window stop",()=>assert.match(analyzeDecision(mission,37,"HARD","PUSH")[0],/3 laps/));
