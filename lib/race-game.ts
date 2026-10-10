export type MissionKey="silverstone"|"monaco"|"singapore";
export type GameTyre="SOFT"|"MEDIUM"|"HARD"|"INTER";
export type Difficulty="RECRUIT"|"ENGINEER"|"STRATEGIST";
export type Mission={key:MissionKey;name:string;circuit:string;startLap:number;totalLaps:number;startPosition:number;targetPosition:number;seed:number;condition:string;brief:string;primaryEventLap:number;safetyCarLap?:number;optimalPitLap:number;optimalTyre:GameTyre};
export const MISSIONS:Mission[]=[
 {key:"silverstone",name:"THE CROSSOVER",circuit:"SILVERSTONE",startLap:31,totalLaps:52,startPosition:2,targetPosition:3,seed:24031,condition:"MIXED WEATHER",brief:"Rain is approaching. Protect Norris's podium through the crossover.",primaryEventLap:34,optimalPitLap:34,optimalTyre:"INTER"},
 {key:"monaco",name:"THE UNDERCUT",circuit:"MONACO",startLap:41,totalLaps:78,startPosition:5,targetPosition:3,seed:24041,condition:"TRACK POSITION",brief:"Overtaking is nearly impossible. Use the undercut to gain two places.",primaryEventLap:45,optimalPitLap:45,optimalTyre:"HARD"},
 {key:"singapore",name:"THE NEUTRALIZATION",circuit:"SINGAPORE",startLap:34,totalLaps:62,startPosition:6,targetPosition:4,seed:24034,condition:"SAFETY CAR",brief:"A safety car is likely. Time the stop and recover to P4 or better.",primaryEventLap:38,safetyCarLap:40,optimalPitLap:40,optimalTyre:"HARD"},
];
export function missionByKey(key:MissionKey){return MISSIONS.find(m=>m.key===key)??MISSIONS[0]}
export function seededNoise(seed:number,index:number){let value=(seed+index*1013904223)>>>0;value=(value*1664525+1013904223)>>>0;return value/4294967296-.5}
export type ScoreInput={mission:Mission;finishPosition:number;pitLap:number|null;selectedTyre:GameTyre;paceMode:string;reactionSeconds:number;completed:boolean};
export type ScoreBreakdown={finalPosition:number;tyreSelection:number;pitTiming:number;paceManagement:number;riskManagement:number;reactionTime:number;total:number;passed:boolean};
export function scoreMission(input:ScoreInput):ScoreBreakdown{
 const passed=input.completed&&input.finishPosition<=input.mission.targetPosition;
 const positionRatio=Math.max(0,Math.min(1,(input.mission.startPosition-input.finishPosition+3)/3));
 const timingDistance=input.pitLap===null?6:Math.abs(input.pitLap-input.mission.optimalPitLap);
 const scores={finalPosition:Math.round(35*positionRatio),tyreSelection:input.selectedTyre===input.mission.optimalTyre?20:4,pitTiming:Math.round(20*Math.max(0,1-timingDistance/5)),paceManagement:input.paceMode==="PUSH"?8:10,riskManagement:input.pitLap===null?2:10,reactionTime:Math.round(5*Math.max(0,1-input.reactionSeconds/20))};
 const raw=Object.values(scores).reduce((a,b)=>a+b,0),total=passed?Math.max(70,raw):Math.min(69,raw);
 return {...scores,total,passed};
}
export function placeChange(start:number,finish:number){return start-finish}
export function resultLabel(score:ScoreBreakdown){if(!score.passed)return "PODIUM MISSED";if(score.total>=92)return "ELITE";if(score.total>=84)return "EXCELLENT";if(score.total>=75)return "STRONG";return "MISSION PASSED"}
export function analyzeDecision(mission:Mission,pitLap:number|null,tyre:GameTyre,mode:string){
 const timing=pitLap===null?`No pit stop was recorded; the optimal window was lap ${mission.optimalPitLap}.`:pitLap===mission.optimalPitLap?`Pit timing matched the modeled optimum on lap ${mission.optimalPitLap}.`:`Stopping on lap ${pitLap} was ${Math.abs(pitLap-mission.optimalPitLap)} lap${Math.abs(pitLap-mission.optimalPitLap)===1?"":"s"} from the modeled optimum.`;
 const compound=tyre===mission.optimalTyre?`${tyre} matched the modeled compound for ${mission.condition.toLowerCase()}.`:`${tyre} was selected; the model preferred ${mission.optimalTyre}.`;
 const pace=mode==="PUSH"?"PUSH created attack opportunities but increased tyre degradation.":`${mode} preserved tyre life but reduced short-run overtaking potential.`;
 return [timing,compound,pace];
}
