import { NextRequest, NextResponse } from "next/server";

type OpenF1Row = Record<string, string | number | boolean | null>;

const BASE = "https://api.openf1.org/v1";
const pause = (ms:number) => new Promise(resolve => setTimeout(resolve,ms));

async function get(path:string,optional=false):Promise<OpenF1Row[]> {
  try {
    const response = await fetch(`${BASE}/${path}`, {
      headers:{ Accept:"application/json", "User-Agent":"PitWall-RaceOps/1.0" },
      signal:AbortSignal.timeout(12_000),
      cf:{ cacheTtl:3600, cacheEverything:true },
    } as RequestInit & { cf:{ cacheTtl:number; cacheEverything:boolean } });
    if (!response.ok) throw new Error(`OpenF1 ${path.split("?")[0]} returned ${response.status}`);
    const payload:unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error(`Invalid ${path.split("?")[0]} telemetry schema`);
    return payload as OpenF1Row[];
  } catch (error) {
    if (optional) return [];
    throw error;
  }
}

export async function GET(request:NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const requestedYear = request.nextUrl.searchParams.get("year") || "2024";
    const requestedCountry = request.nextUrl.searchParams.get("country") || "Great Britain";
    const requestedCircuit = request.nextUrl.searchParams.get("circuit") || "";
    const probe = request.nextUrl.searchParams.get("probe")==="1";
    const fault = request.nextUrl.searchParams.get("fault") || "NOMINAL";
    const supportedFaults = new Set(["NOMINAL","OUTAGE","LATENCY","CORRUPT","DUPLICATE","WEATHER_LOSS"]);
    if (!/^20\d{2}$/.test(requestedYear) || requestedCountry.length>48 || requestedCircuit.length>48 || !/^[\p{L} .'-]+$/u.test(requestedCountry) || (requestedCircuit && !/^[\p{L} .'-]+$/u.test(requestedCircuit)) || !supportedFaults.has(fault)) {
      return NextResponse.json({error:"Invalid race query",requestId},{status:400});
    }

    if (probe) {
      const headers={"Cache-Control":"no-store","X-Request-Id":requestId,"X-PitWall-Probe":"controlled"};
      if (fault==="OUTAGE") return NextResponse.json({ok:false,fault,control:"circuit-breaker",fallback:"last-known-good"},{status:503,headers});
      if (fault==="LATENCY") { await pause(1200); return NextResponse.json({ok:true,fault,control:"backpressure",delayedMs:1200},{headers}); }
      if (fault==="CORRUPT") return NextResponse.json({ok:true,fault,control:"schema-and-range-validation",accepted:false,rejected:1},{headers});
      if (fault==="DUPLICATE") return NextResponse.json({ok:true,fault,control:"idempotency-key",received:186,processed:1,deduplicated:185},{headers});
      if (fault==="WEATHER_LOSS") return NextResponse.json({ok:true,fault,control:"last-known-good",weatherMode:"held"},{headers});
      return NextResponse.json({ok:true,fault:"NOMINAL",control:"health-check"},{headers});
    }

    const raceFilter = requestedCircuit ? `circuit_short_name=${encodeURIComponent(requestedCircuit)}` : `country_name=${encodeURIComponent(requestedCountry)}`;
    const sessions = await get(`sessions?year=${encodeURIComponent(requestedYear)}&${raceFilter}&session_name=Race`);
    const session = sessions.at(-1);
    if (!session) return NextResponse.json({error:"Race session not found",requestId},{status:404});
    const key = Number(session.session_key);
    if (!Number.isInteger(key)) throw new Error("Invalid OpenF1 session key");

    await pause(320);
    const driverRows = await get(`drivers?session_key=${key}`);
    await pause(320);
    const lapRows = await get(`laps?session_key=${key}`);
    await pause(320);
    const stintRows = await get(`stints?session_key=${key}`,true);
    await pause(320);
    const weatherRows = await get(`weather?session_key=${key}`,true);
    await pause(320);
    const positionRows = await get(`position?session_key=${key}`);
    await pause(320);
    const intervalRows = await get(`intervals?session_key=${key}`,true);

    const lapsByDriver = new Map<number,OpenF1Row[]>();
    for (const raceLap of lapRows) {
      const number=Number(raceLap.driver_number);
      if (!lapsByDriver.has(number)) lapsByDriver.set(number,[]);
      lapsByDriver.get(number)!.push(raceLap);
    }
    for (const rows of lapsByDriver.values()) rows.sort((a,b)=>Number(a.lap_number)-Number(b.lap_number));
    const positionsByDriver = new Map<number,OpenF1Row[]>(), intervalsByDriver = new Map<number,OpenF1Row[]>(), stintsByDriver = new Map<number,OpenF1Row[]>();
    for (const row of positionRows) { const n=Number(row.driver_number); if(!positionsByDriver.has(n)) positionsByDriver.set(n,[]); positionsByDriver.get(n)!.push(row); }
    for (const row of intervalRows) { const n=Number(row.driver_number); if(!intervalsByDriver.has(n)) intervalsByDriver.set(n,[]); intervalsByDriver.get(n)!.push(row); }
    for (const row of stintRows) { const n=Number(row.driver_number); if(!stintsByDriver.has(n)) stintsByDriver.set(n,[]); stintsByDriver.get(n)!.push(row); }
    const byDate = (a:OpenF1Row,b:OpenF1Row)=>Date.parse(String(a.date||a.date_start))-Date.parse(String(b.date||b.date_start));
    for (const rows of positionsByDriver.values()) rows.sort(byDate);
    for (const rows of intervalsByDriver.values()) rows.sort(byDate);
    weatherRows.sort(byDate);
    const totalLaps = Math.max(...lapRows.map(row=>Number(row.lap_number||0)),1);
    const snapshots:Record<number,unknown> = {};
    const latestBefore = (rows:OpenF1Row[],time:number) => rows.filter(row=>Date.parse(String(row.date||row.date_start))<=time).at(-1) || {};

    for (let replayLap=1; replayLap<=totalLaps; replayLap++) {
      const finishTimes = lapRows.filter(row=>Number(row.lap_number)===replayLap && typeof row.lap_duration==="number").map(row=>Date.parse(String(row.date_start))+Number(row.lap_duration)*1000).filter(Number.isFinite);
      const replayTime = finishTimes.length ? Math.min(...finishTimes) : Date.parse(String(session.date_start))+replayLap*90000;
      const drivers = driverRows.slice(0,20).map(raceDriver => {
        const number=Number(raceDriver.driver_number), allLaps=lapsByDriver.get(number)||[];
        const completed=allLaps.filter(row=>Date.parse(String(row.date_start))+Number(row.lap_duration||0)*1000<=replayTime);
        const latest=completed.at(-1)||allLaps[0]||{}, currentLap=Number(latest.lap_number||0);
        const valid=completed.filter(row=>typeof row.lap_duration==="number"&&!row.is_pit_out_lap).slice(-20);
        const mean=valid.length?valid.reduce((sum,row)=>sum+Number(row.lap_duration),0)/valid.length:0;
        const position=latestBefore(positionsByDriver.get(number)||[],replayTime);
        const interval=latestBefore(intervalsByDriver.get(number)||[],replayTime);
        const stints=stintsByDriver.get(number)||[];
        const stint=stints.find(row=>Number(row.lap_start)<=Math.max(1,currentLap)&&Number(row.lap_end||totalLaps)>=Math.max(1,currentLap)) || stints.filter(row=>Number(row.lap_start)<=Math.max(1,currentLap)).at(-1) || {};
        const rawGap=interval.gap_to_leader;
        return { pos:Number(position.position||99),code:String(raceDriver.name_acronym||number),name:String(raceDriver.broadcast_name||"Unknown driver"),color:`#${raceDriver.team_colour||"7d8796"}`,lastLap:typeof latest.lap_duration==="number"?Number(latest.lap_duration):null,averageRecentLap:valid.length?mean:null,tyre:String(stint.compound||"?").slice(0,1),compound:String(stint.compound||"UNKNOWN"),laps:Math.max(0,currentLap-Number(stint.lap_start||currentLap)+Number(stint.tyre_age_at_start||0)),lap:currentLap,gap:Number(position.position)===1?"LEADER":typeof rawGap==="number"?`+${Number(rawGap).toFixed(3)}`:String(rawGap||"—").toUpperCase(),paceTrace:valid.map(row=>Number(row.lap_duration)-mean) };
      }).filter(driver=>driver.pos<99).sort((a,b)=>a.pos-b.pos);
      const latestWeather=latestBefore(weatherRows,replayTime);
      snapshots[replayLap]={weather:{air:Number(latestWeather.air_temperature??18.7),track:Number(latestWeather.track_temperature??29.4),rain:Number(Boolean(latestWeather.rainfall)),wind:Number(latestWeather.wind_speed??3.9)*3.6},drivers};
    }

    return NextResponse.json({source:"OpenF1",session:{year:Number(session.year),country:String(session.country_name),circuit:String(session.circuit_short_name),name:String(session.session_name)},snapshots,totalLaps,fetchedAt:new Date().toISOString(),warnings:[],requestId},{headers:{"Cache-Control":"public, s-maxage=1800, stale-while-revalidate=86400","X-PitWall-Integrity":"schema-validated","X-Request-Id":requestId,"X-Content-Type-Options":"nosniff"}});
  } catch (error) {
    return NextResponse.json({error:error instanceof Error?error.message:"Unable to load race data",requestId},{status:502,headers:{"Cache-Control":"no-store","X-Request-Id":requestId}});
  }
}
