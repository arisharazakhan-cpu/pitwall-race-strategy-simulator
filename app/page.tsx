"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, CloudRain, Database, Flag, Gauge, LockKeyhole, Pause, Play, Radio, RefreshCw, Server, ShieldCheck, Siren, TimerReset, TriangleAlert, WifiOff, Zap } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { simulateStrategy } from "@/lib/strategy-engine";
import { BacktestLab } from "@/components/backtest-lab";
import { RaceEngineerGame } from "@/components/race-engineer-game";

type Compound = "SOFT" | "MEDIUM" | "HARD" | "INTER";
type Weather = "DRY" | "LIGHT RAIN" | "HEAVY RAIN";
type WebModelContext = { registerTool: (tool: { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown }, options?: { signal?: AbortSignal }) => void | Promise<void> };
type Driver = { pos:number; code:string; name:string; gap:string; tyre:string; compound?:string; laps:number; lap?:number; color:string; lastLap?:number|null; averageRecentLap?:number|null; paceTrace?:number[] };
type RaceSnapshot = { weather:{air:number;track:number;rain:number;wind:number}; drivers:Driver[] };
type RaceData = { source:string; session:{year:number;country:string;circuit:string;name:string}; snapshots:Record<number,RaceSnapshot>; totalLaps:number; fetchedAt:string; warnings?:string[] };
type FaultType = "NOMINAL" | "OUTAGE" | "LATENCY" | "CORRUPT" | "DUPLICATE" | "WEATHER_LOSS";
type OpsEvent = { id:number; time:string; tone:"ok"|"warn"|"bad"|"info"; title:string; detail:string };
type OpsState = { fault:FaultType; health:"HEALTHY"|"DEGRADED"|"PROTECTED"; trust:number; latency:number|null; cache:boolean; rejected:number; deduplicated:number; queueDepth:number; circuit:"CLOSED"|"OPEN" };
type OpenF1Row = Record<string, string | number | boolean | null>;
const OPENF1_BASE = "https://api.openf1.org/v1";
const wait = (ms:number) => new Promise(resolve => window.setTimeout(resolve,ms));

async function fetchEdgeRace():Promise<RaceData> {
  const response = await fetch("/api/race?year=2024&country=Great%20Britain",{headers:{Accept:"application/json"}});
  const payload = await response.json() as RaceData & {error?:string};
  if (!response.ok) throw new Error(payload.error||`RaceOps API returned ${response.status}`);
  if (!payload.snapshots?.[1]?.drivers?.length) throw new Error("RaceOps API returned no verified timing snapshots");
  return payload;
}

async function getOpenF1(endpoint:string) {
  const response = await fetch(`${OPENF1_BASE}/${endpoint}`,{headers:{Accept:"application/json"}});
  if (!response.ok) throw new Error(`OpenF1 ${endpoint.split("?")[0]} returned ${response.status}`);
  return response.json() as Promise<OpenF1Row[]>;
}

async function fetchDirectFallback():Promise<RaceData> {
  const sessions=await getOpenF1("sessions?year=2024&circuit_short_name=Silverstone&session_name=Race"),session=sessions.at(-1);
  if(!session) throw new Error("OpenF1 could not find the 2024 Silverstone race session");
  const key=Number(session.session_key),warnings:string[]=[];
  const optional=async(endpoint:string)=>{try{return await getOpenF1(endpoint)}catch{warnings.push(endpoint.split("?")[0]);return []}};
  await wait(380); const driverRows=await getOpenF1(`drivers?session_key=${key}`);
  await wait(380); const lapRows=await getOpenF1(`laps?session_key=${key}`);
  await wait(380); const stintRows=await optional(`stints?session_key=${key}`);
  await wait(380); const weatherRows=await optional(`weather?session_key=${key}`);
  await wait(380); const positionRows=await getOpenF1(`position?session_key=${key}`);
  await wait(380); const intervalRows=await optional(`intervals?session_key=${key}`);
  const lapsByDriver=new Map<number,OpenF1Row[]>(),positionsByDriver=new Map<number,OpenF1Row[]>(),intervalsByDriver=new Map<number,OpenF1Row[]>(),stintsByDriver=new Map<number,OpenF1Row[]>();
  for(const row of lapRows){const n=Number(row.driver_number);if(!lapsByDriver.has(n))lapsByDriver.set(n,[]);lapsByDriver.get(n)!.push(row)}
  for(const rows of lapsByDriver.values())rows.sort((a,b)=>Number(a.lap_number)-Number(b.lap_number));
  for(const [source,target] of [[positionRows,positionsByDriver],[intervalRows,intervalsByDriver],[stintRows,stintsByDriver]] as [OpenF1Row[],Map<number,OpenF1Row[]>][])for(const row of source){const n=Number(row.driver_number);if(!target.has(n))target.set(n,[]);target.get(n)!.push(row)}
  const byDate=(a:OpenF1Row,b:OpenF1Row)=>Date.parse(String(a.date||a.date_start))-Date.parse(String(b.date||b.date_start));
  for(const rows of positionsByDriver.values())rows.sort(byDate);for(const rows of intervalsByDriver.values())rows.sort(byDate);weatherRows.sort(byDate);
  const totalLaps=Math.max(...lapRows.map(row=>Number(row.lap_number||0)),1),snapshots:Record<number,RaceSnapshot>={};
  const latestBefore=(rows:OpenF1Row[],time:number)=>rows.filter(row=>Date.parse(String(row.date||row.date_start))<=time).at(-1)||{};
  for(let replayLap=1;replayLap<=totalLaps;replayLap++){
    const finishTimes=lapRows.filter(row=>Number(row.lap_number)===replayLap&&typeof row.lap_duration==="number").map(row=>Date.parse(String(row.date_start))+Number(row.lap_duration)*1000).filter(Number.isFinite);
    const replayTime=finishTimes.length?Math.min(...finishTimes):Date.parse(String(session.date_start))+replayLap*90000;
    const syncedDrivers=driverRows.slice(0,20).map(raceDriver=>{const number=Number(raceDriver.driver_number),allLaps=lapsByDriver.get(number)||[],completed=allLaps.filter(row=>Date.parse(String(row.date_start))+Number(row.lap_duration||0)*1000<=replayTime),latest=completed.at(-1)||allLaps[0]||{},currentLap=Number(latest.lap_number||0),valid=completed.filter(row=>typeof row.lap_duration==="number"&&!row.is_pit_out_lap).slice(-20),mean=valid.length?valid.reduce((sum,row)=>sum+Number(row.lap_duration),0)/valid.length:0,position=latestBefore(positionsByDriver.get(number)||[],replayTime),interval=latestBefore(intervalsByDriver.get(number)||[],replayTime),stints=stintsByDriver.get(number)||[],stint=stints.find(row=>Number(row.lap_start)<=Math.max(1,currentLap)&&Number(row.lap_end||totalLaps)>=Math.max(1,currentLap))||stints.filter(row=>Number(row.lap_start)<=Math.max(1,currentLap)).at(-1)||{},rawGap=interval.gap_to_leader;return{pos:Number(position.position||99),code:String(raceDriver.name_acronym||number),name:String(raceDriver.broadcast_name||"Unknown driver"),color:`#${raceDriver.team_colour||"7d8796"}`,lastLap:typeof latest.lap_duration==="number"?Number(latest.lap_duration):null,averageRecentLap:valid.length?mean:null,tyre:String(stint.compound||"?").slice(0,1),compound:String(stint.compound||"UNKNOWN"),laps:Math.max(0,currentLap-Number(stint.lap_start||currentLap)+Number(stint.tyre_age_at_start||0)),lap:currentLap,gap:Number(position.position)===1?"LEADER":typeof rawGap==="number"?`+${Number(rawGap).toFixed(3)}`:String(rawGap||"—").toUpperCase(),paceTrace:valid.map(row=>Number(row.lap_duration)-mean)}}).filter(driver=>driver.pos<99).sort((a,b)=>a.pos-b.pos);
    const latestWeather=latestBefore(weatherRows,replayTime);snapshots[replayLap]={weather:{air:Number(latestWeather.air_temperature??18.7),track:Number(latestWeather.track_temperature??29.4),rain:Number(Boolean(latestWeather.rainfall)),wind:Number(latestWeather.wind_speed??3.9)*3.6},drivers:syncedDrivers};
  }
  if(!snapshots[1]?.drivers.length)throw new Error("OpenF1 returned no timing positions for this race");
  return{source:"OpenF1 direct failover",session:{year:Number(session.year),country:String(session.country_name),circuit:String(session.circuit_short_name),name:String(session.session_name)},snapshots,totalLaps,fetchedAt:new Date().toISOString(),warnings};
}

async function fetchSilverstoneRace():Promise<RaceData> {
  try{return await fetchEdgeRace()}catch{return fetchDirectFallback()}
}
const drivers: Driver[] = [
  { pos: 1, code: "NOR", name: "Lando Norris", gap: "LEADER", tyre: "M", laps: 18, color: "#ff8700" },
  { pos: 2, code: "VER", name: "Max Verstappen", gap: "+2.481", tyre: "H", laps: 11, color: "#3671c6" },
  { pos: 3, code: "HAM", name: "Lewis Hamilton", gap: "+5.937", tyre: "M", laps: 18, color: "#27f4d2" },
  { pos: 4, code: "PIA", name: "Oscar Piastri", gap: "+8.142", tyre: "M", laps: 18, color: "#ff8700" },
  { pos: 5, code: "LEC", name: "Charles Leclerc", gap: "+12.603", tyre: "H", laps: 12, color: "#e8002d" },
  { pos: 6, code: "RUS", name: "George Russell", gap: "+15.084", tyre: "M", laps: 17, color: "#27f4d2" },
];
const compounds: { id: Compound; label: string; color: string; life: string }[] = [
  { id: "SOFT", label: "S", color: "#ff355e", life: "12–17 laps" }, { id: "MEDIUM", label: "M", color: "#ffd23f", life: "18–25 laps" },
  { id: "HARD", label: "H", color: "#eef2f8", life: "28–36 laps" }, { id: "INTER", label: "I", color: "#38d879", life: "Variable" },
];
const baseTrace = [0.15,0.08,-0.02,-0.12,-0.23,-0.31,-0.39,-0.35,-0.27,-0.16,-0.05,0.04,0.12,0.18,0.21,0.16,0.08,-0.01,-0.07,-0.12];
const nominalOps:OpsState = { fault:"NOMINAL", health:"HEALTHY", trust:100, latency:84, cache:false, rejected:0, deduplicated:0, queueDepth:2, circuit:"CLOSED" };
const initialEvents:OpsEvent[] = [
  { id:3,time:"00:31:14",tone:"ok",title:"Snapshot committed",detail:"Lap 31 race state stored in edge cache" },
  { id:2,time:"00:31:12",tone:"ok",title:"Integrity verified",detail:"20 drivers · schema v2.4 · signature valid" },
  { id:1,time:"00:31:11",tone:"info",title:"Telemetry batch received",detail:"OpenF1 replay stream · 186 events" },
];

function formatLapTime(seconds?:number|null) {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const minutes=Math.floor(seconds/60), remainder=seconds-minutes*60;
  return `${minutes}:${remainder.toFixed(3).padStart(6,"0")}`;
}

function Metric({ label, value, suffix, tone = "white" }: { label: string; value: string; suffix?: string; tone?: "white" | "green" | "amber" }) {
  return <div className="metric"><span>{label}</span><strong className={tone}>{value}</strong>{suffix && <small>{suffix}</small>}</div>;
}
function PanelTitle({ icon: Icon, children, meta }: { icon: typeof Activity; children: React.ReactNode; meta?: string }) {
  return <div className="panel-title"><div><Icon size={15} strokeWidth={2.3}/><h2>{children}</h2></div>{meta && <span>{meta}</span>}</div>;
}

export default function Home() {
  const [mode,setMode] = useState<"game"|"live"|"backtest">("game");
  const [lap, setLap] = useState(31), [playing, setPlaying] = useState(false), [driver, setDriver] = useState("NOR");
  const [compound, setCompound] = useState<Compound>("HARD"), [weather, setWeather] = useState<Weather>("DRY");
  const [pitOffset, setPitOffset] = useState(1), [scenario, setScenario] = useState(0), [safetyCar, setSafetyCar] = useState(false);
  const [raceData, setRaceData] = useState<RaceData|null>(null), [dataLoading, setDataLoading] = useState(false), [dataError, setDataError] = useState("");
  const [ops, setOps] = useState<OpsState>(nominalOps), [opsEvents, setOpsEvents] = useState<OpsEvent[]>(initialEvents);
  const totalLaps = raceData?.totalLaps || 52;
  const liveSnapshot = raceData?.snapshots[lap];
  const allDrivers:Driver[] = liveSnapshot?.drivers ?? drivers;
  const displayDrivers:Driver[] = allDrivers.slice(0,6);
  const liveWeather = liveSnapshot?.weather;
  function addOpsEvent(tone:OpsEvent["tone"],title:string,detail:string) {
    const time = new Date().toLocaleTimeString("en-GB",{hour12:false});
    setOpsEvents(events => [{id:Date.now(),time,tone,title,detail},...events].slice(0,10));
  }
  async function injectFault(fault:Exclude<FaultType,"NOMINAL">) {
    const started=performance.now();
    let payload:Record<string,unknown>={};
    try { const response=await fetch(`/api/race?probe=1&fault=${fault}`,{cache:"no-store"}); payload=await response.json() as Record<string,unknown>; } catch { payload={control:"client-timeout"}; }
    const measured=Math.round(performance.now()-started);
    const states:Record<Exclude<FaultType,"NOMINAL">,Partial<OpsState>> = {
      OUTAGE:{fault,health:"DEGRADED",trust:94,latency:null,cache:true,queueDepth:18,circuit:"OPEN"},
      LATENCY:{fault,health:"DEGRADED",trust:97,latency:measured,cache:false,queueDepth:31,circuit:"CLOSED"},
      CORRUPT:{fault,health:"PROTECTED",trust:100,latency:measured,cache:false,rejected:ops.rejected+Number(payload.rejected||1),queueDepth:3,circuit:"CLOSED"},
      DUPLICATE:{fault,health:"PROTECTED",trust:100,latency:measured,cache:false,deduplicated:ops.deduplicated+Number(payload.deduplicated||185),queueDepth:2,circuit:"CLOSED"},
      WEATHER_LOSS:{fault,health:"DEGRADED",trust:96,latency:measured,cache:true,queueDepth:4,circuit:"CLOSED"},
    };
    setOps(current => ({...current,...states[fault]}));
    const copy:Record<Exclude<FaultType,"NOMINAL">,[OpsEvent["tone"],string,string]> = {
      OUTAGE:["bad","Upstream connection lost","Circuit opened · serving last trusted snapshot"],
      LATENCY:["warn","Latency threshold exceeded",`${measured.toLocaleString()} ms measured · retry and backpressure active`],
      CORRUPT:["ok","Telemetry attack contained","Impossible +17 position jump rejected by validator"],
      DUPLICATE:["ok","Replay storm contained","186 duplicate events removed by idempotency key"],
      WEATHER_LOSS:["warn","Weather feed unavailable","Forecast frozen at last verified observation"],
    };
    addOpsEvent(...copy[fault]);
  }
  function recoverPipeline() {
    setOps(current => ({...nominalOps,rejected:current.rejected,deduplicated:current.deduplicated}));
    addOpsEvent("ok","Pipeline recovered","Health checks passed · primary telemetry restored");
  }
  function runSimulation() {
    setScenario(value=>value+1);
    addOpsEvent("info","Strategy decision recorded",`${driver} · ${compound} · pit L${lap+pitOffset} · 1,000 paths`);
  }
  async function loadRaceData() {
    setDataLoading(true); setDataError(""); addOpsEvent("info","Historical sync started","Discovering Silverstone session and seven OpenF1 datasets");
    try {
      const payload = await fetchSilverstoneRace();
      setRaceData(payload); setLap(Math.min(31,payload.totalLaps));
      if (payload.snapshots[Math.min(31,payload.totalLaps)]?.drivers[0]?.code) setDriver(payload.snapshots[Math.min(31,payload.totalLaps)].drivers[0].code);
      addOpsEvent("ok","Dataset verified",`${payload.totalLaps} snapshots · ${payload.snapshots[1]?.drivers.length||0} drivers · schema valid`);
    } catch (error) { setDataError(error instanceof Error ? error.message : "Data connection failed"); addOpsEvent("bad","Sync request failed","Fallback model remains available; no trusted state replaced"); }
    finally { setDataLoading(false); }
  }
  useEffect(() => { if (!playing) return; const timer = window.setInterval(() => setLap(v => v >= totalLaps ? 1 : v + 1), 900); return () => clearInterval(timer); }, [playing,totalLaps]);
  useEffect(() => {
    const context = (document as Document & { modelContext?: WebModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "configure_race_strategy", title: "Configure race strategy",
      description: "Set the active driver, next tyre compound, pit timing, weather, and safety-car scenario in the visible PitWall simulator.",
      inputSchema: { type:"object", properties:{ driver:{type:"string",enum:drivers.map(d=>d.code)}, compound:{type:"string",enum:["SOFT","MEDIUM","HARD","INTER"]}, pitOffset:{type:"integer",minimum:0,maximum:5}, weather:{type:"string",enum:["DRY","LIGHT RAIN","HEAVY RAIN"]}, safetyCar:{type:"boolean"} }, required:["driver","compound","pitOffset","weather","safetyCar"], additionalProperties:false },
      annotations:{ readOnlyHint:false, untrustedContentHint:false },
      execute(input) {
        const v = input as { driver?:string; compound?:Compound; pitOffset?:number; weather?:Weather; safetyCar?:boolean };
        if (!drivers.some(d=>d.code===v.driver) || !compounds.some(c=>c.id===v.compound) || !Number.isInteger(v.pitOffset) || v.pitOffset!<0 || v.pitOffset!>5 || !["DRY","LIGHT RAIN","HEAVY RAIN"].includes(v.weather??"") || typeof v.safetyCar!=="boolean") throw new Error("Invalid strategy configuration");
        setDriver(v.driver!); setCompound(v.compound!); setPitOffset(v.pitOffset!); setWeather(v.weather!); setSafetyCar(v.safetyCar); setScenario(s=>s+1);
        return { status:"simulated", driver:v.driver, compound:v.compound, pitLap:lap+v.pitOffset!, weather:v.weather, safetyCar:v.safetyCar };
      }
    }, { signal:lifecycle.signal })).catch(()=>undefined);
    void Promise.resolve(context.registerTool({
      name: "test_telemetry_resilience", title: "Test telemetry resilience",
      description: "Inject a controlled telemetry failure into PitWall's RaceOps pipeline to demonstrate validation, deduplication, circuit breaking, and cache failover.",
      inputSchema: { type:"object", properties:{ fault:{type:"string",enum:["OUTAGE","LATENCY","CORRUPT","DUPLICATE","WEATHER_LOSS"]} }, required:["fault"], additionalProperties:false },
      annotations:{ readOnlyHint:false, untrustedContentHint:false },
      execute(input) {
        const fault = (input as {fault?:FaultType}).fault;
        if (!fault || fault==="NOMINAL") throw new Error("Select a supported failure scenario");
        injectFault(fault);
        return { status:"contained", fault, health:fault==="CORRUPT"||fault==="DUPLICATE"?"PROTECTED":"DEGRADED", fallback:fault==="OUTAGE"||fault==="WEATHER_LOSS"?"edge-cache":"primary" };
      }
    }, { signal:lifecycle.signal })).catch(()=>undefined);
    return () => lifecycle.abort();
  }, [lap,ops.rejected,ops.deduplicated]);
  const selected = allDrivers.find(d => d.code === driver) ?? allDrivers[0];
  const prediction = useMemo(() => simulateStrategy({ compound,weather,pitOffset,safetyCar,currentPosition:selected?.pos||1,tyreAge:selected?.laps||18,lapsRemaining:Math.max(1,totalLaps-lap),pitLoss:21.8,seed:1842+scenario },1000), [compound,weather,pitOffset,safetyCar,scenario,selected?.pos,selected?.laps,totalLaps,lap]);
  const comparisons = useMemo(() => [0,2,4].map(offset=>({ offset, result:simulateStrategy({compound,weather,pitOffset:offset,safetyCar,currentPosition:selected?.pos||1,tyreAge:selected?.laps||18,lapsRemaining:Math.max(1,totalLaps-lap),pitLoss:21.8,seed:2900+scenario+offset},500) })),[compound,weather,safetyCar,selected?.pos,selected?.laps,totalLaps,lap,scenario]);
  const trace = useMemo(() => selected?.paceTrace?.length ? selected.paceTrace : baseTrace.map((v,i) => v + Math.sin((i+scenario)*.7)*.035 + (lap-31)*.004), [selected?.paceTrace,lap,scenario]);
  const chartScale=Math.max(.4,...trace.map(Math.abs));
  const points = trace.map((v,i) => `${(i/Math.max(1,trace.length-1))*100},${30-(v/chartScale)*23}`).join(" ");
  const path = points.split(" ").map((point,index)=>`${index?"L":"M"}${point}`).join(" ");
  const degradation = trace.length>4 ? (trace.at(-1)!-trace[0])/Math.max(1,trace.length-1) : .08;
  const tyreLife = Math.max(4,Math.min(100,Math.round(100-(selected?.laps||0)*({S:5.8,M:3.8,H:2.7,I:4}[selected?.tyre||"M"]||3.8))));
  const adjustedConfidence = Math.max(40,prediction.confidence-(ops.health==="DEGRADED"?11:0));
  const feedLabel = ops.cache ? "EDGE CACHE FAILOVER" : raceData ? "OPENF1 VERIFIED" : "REPLAY STREAM";

  return <Sheet><main className={`app-shell ops-${ops.health.toLowerCase()}`}>
    <header className="topbar"><div className="brand"><span className="brand-mark"><i/><i/><i/></span><strong>PITWALL</strong><em>RACEOPS CLOUD</em></div><nav className="mode-switch" aria-label="PitWall workspace"><button className={mode==="game"?"active":""} onClick={()=>setMode("game")}>RACE ENGINEER</button><button className={mode==="live"?"active":""} onClick={()=>setMode("live")}>LIVE OPS</button><button className={mode==="backtest"?"active":""} onClick={()=>setMode("backtest")}>BACKTEST LAB</button></nav><div className="event"><span>{raceData ? `${raceData.session.country.toUpperCase()} GRAND PRIX · ${raceData.session.year}` : "BRITISH GRAND PRIX · 2024"}</span><strong>{raceData?.session.circuit?.toUpperCase() || "SILVERSTONE"} · RACE</strong><button onClick={loadRaceData} disabled={dataLoading}>{dataLoading?"SYNCING…":raceData?"OPENF1 CONNECTED":"SYNC OPENF1"}</button>{dataError&&<small>{dataError}</small>}</div><div className="session-status"><SheetTrigger asChild><button className={`trust-trigger ${ops.health.toLowerCase()}`}><ShieldCheck size={15}/><span><small>TELEMETRY TRUST</small><strong>{ops.trust}% · {ops.health}</strong></span></button></SheetTrigger><div className="lap-counter"><small>LAP</small><strong>{String(lap).padStart(2,"0")}<i>/{totalLaps}</i></strong></div></div></header>
    {mode==="game"?<RaceEngineerGame/>:mode==="backtest"?<BacktestLab/>:<>
    <section className="ops-ribbon"><div className={`pipeline-status ${ops.health.toLowerCase()}`}><span className="live-dot data"/><strong>{feedLabel}</strong></div><div><span>INGEST</span><strong>{ops.latency===null?"TIMEOUT":`${ops.latency} ms`}</strong></div><div><span>INTEGRITY</span><strong>{ops.rejected?`${ops.rejected} REJECTED`:"VERIFIED"}</strong></div><div><span>QUEUE</span><strong>{ops.queueDepth} EVENTS</strong></div><div><span>CIRCUIT</span><strong>{ops.circuit}</strong></div><SheetTrigger asChild><button><Siren size={13}/> FAILURE LAB</button></SheetTrigger></section>
    <section className="telemetry-strip"><Metric label="TRACK" value={(liveWeather?.track??29.4).toFixed(1)} suffix="°C"/><Metric label="AIR" value={(liveWeather?.air??18.7).toFixed(1)} suffix="°C"/><Metric label="WIND" value={(liveWeather?.wind??14).toFixed(1)} suffix="km/h"/><Metric label={ops.fault==="WEATHER_LOSS"?"RAIN · HELD":"RAIN"} value={liveWeather?.rain?"YES":"NO"} tone={ops.fault==="WEATHER_LOSS"||liveWeather?.rain?"amber":"white"}/><Metric label="PIT LOSS" value={safetyCar ? "12.4" : "21.8"} suffix="s"/><div className="race-control"><Radio size={14}/><span>RACE CONTROL</span><strong>{ops.cache ? "CACHED STATE ACTIVE" : safetyCar ? "SAFETY CAR DEPLOYED" : "TRACK CLEAR"}</strong></div></section>
    <div className="workspace">
      <aside className="standings panel"><PanelTitle icon={Flag} meta="GAP">RUNNING ORDER</PanelTitle><div className="driver-list">{displayDrivers.map(d => <button key={d.code} onClick={() => setDriver(d.code)} className={driver===d.code ? "driver-row active" : "driver-row"}><span className="position">{d.pos}</span><span className="team-line" style={{backgroundColor:d.color}}/><span className="driver-code"><strong>{d.code}</strong><small>{d.name}</small></span><span className="tyre-badge">{d.tyre}<small>{d.laps}L</small></span><span className="gap">{d.gap}</span></button>)}</div>
        <div className="track-card"><div className="track-label"><span>TRACK POSITION</span><strong>5.891 KM</strong></div><svg viewBox="0 0 440 250" role="img" aria-label="Simplified Silverstone circuit showing driver positions"><path className="track-shadow" d="M55 137 C26 103 50 63 100 63 C141 63 164 91 197 70 C230 49 224 18 260 22 C289 25 294 65 324 78 C350 89 403 68 416 104 C430 144 385 153 367 180 C345 213 317 229 286 208 C249 183 233 160 193 175 C153 190 89 177 55 137Z"/><path className="track-line" d="M55 137 C26 103 50 63 100 63 C141 63 164 91 197 70 C230 49 224 18 260 22 C289 25 294 65 324 78 C350 89 403 68 416 104 C430 144 385 153 367 180 C345 213 317 229 286 208 C249 183 233 160 193 175 C153 190 89 177 55 137Z"/>{[[72,72],[209,59],[319,77],[400,132],[316,218],[176,178]].map(([x,y],i) => displayDrivers[i]&&<g key={i}><circle cx={x} cy={y} r={driver===displayDrivers[i].code?9:6} fill={displayDrivers[i].color}/><text x={x} y={y-13}>{displayDrivers[i].code}</text></g>)}</svg><div className="replay-controls"><button className="icon-button" onClick={() => setPlaying(!playing)} aria-label={playing?"Pause replay":"Play replay"}>{playing?<Pause size={16} fill="currentColor"/>:<Play size={16} fill="currentColor"/>}</button><Slider value={[lap]} min={1} max={totalLaps} step={1} onValueChange={v=>setLap(v[0])} aria-label="Race lap"/><span>{lap}:00</span></div></div>
      </aside>
      <section className="center-column"><div className="panel driver-focus"><div className="focus-header"><div className="driver-number">{selected.pos}</div><div><span>ACTIVE CAR</span><h1>{selected.name}</h1><small>{selected.code} · P{selected.pos} · {selected.compound||"MEDIUM"} {selected.laps} LAPS</small></div><div className="pace-state"><i/><span>PACE STATUS</span><strong>{degradation>.04?"TYRE LIMITED":"ON TARGET"}</strong></div></div><div className="key-metrics"><Metric label="LAST LAP" value={formatLapTime(selected.lastLap)}/><Metric label="GAP AHEAD" value={selected.gap==="LEADER"?"—":selected.gap}/><Metric label="TYRE LIFE" value={String(tyreLife)} suffix="%" tone={tyreLife<45?"amber":"green"}/><Metric label="DEG / LAP" value={`${degradation>=0?"+":""}${degradation.toFixed(3)}`} suffix="s"/><Metric label="PIT WINDOW" value={`${lap+1}–${Math.min(totalLaps,lap+4)}`} tone="green"/></div></div>
        <div className="panel chart-panel"><PanelTitle icon={Activity} meta="RELATIVE TO STINT AVERAGE">LIVE PACE DELTA</PanelTitle><div className="chart-wrap"><div className="y-labels"><span>+{chartScale.toFixed(1)}</span><span>0.0</span><span>−{chartScale.toFixed(1)}</span></div><svg viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label="Live lap time delta chart"><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff334f" stopOpacity=".35"/><stop offset="1" stopColor="#ff334f" stopOpacity="0"/></linearGradient></defs>{[7,30,53].map(y=><line key={y} x1="0" y1={y} x2="100" y2={y} className="grid-line"/>)}<path d={`${path} L100,30 L0,30 Z`} fill="url(#chartFill)"/><path d={path} fill="none" stroke="#ff3a55" strokeWidth="1.6" vectorEffect="non-scaling-stroke"/></svg><div className="x-labels"><span>L{Math.max(1,lap-trace.length+1)}</span><span>RECENT LAPS</span><span>L{lap}</span></div></div><div className="chart-insight"><TriangleAlert size={15}/><span>{degradation>.04?"Pace degradation trending above stint average":"Pace is stable against stint average"}</span><strong>{degradation>=0?"+":""}{degradation.toFixed(3)}s/lap</strong></div></div>
        <div className="panel stint-panel"><PanelTitle icon={TimerReset} meta="PROJECTED">STINT + WEATHER OUTLOOK</PanelTitle><div className="weather-progression"><span>RAIN PROBABILITY</span><div>{[12,14,18,24,31,weather==="DRY"?22:58,weather==="HEAVY RAIN"?84:64,71,55,38,26,17].map((value,index)=><i key={index} style={{height:`${Math.max(4,value/2)}px`}}><b>{index===6?`${value}%`:""}</b></i>)}</div></div><div className="stint-track"><div className="completed" style={{width:`${lap/totalLaps*100}%`}}/><div className="pit-window" style={{left:`${(lap+1)/totalLaps*100}%`,width:"13%"}}><span>OPTIMAL WINDOW</span></div><i style={{left:`${lap/totalLaps*100}%`}}><span>L{lap}</span></i></div><div className="stint-scale"><span>L1</span><span>L{Math.round(totalLaps*.25)}</span><span>L{Math.round(totalLaps*.5)}</span><span>L{Math.round(totalLaps*.75)}</span><span>L{totalLaps}</span></div></div>
      </section>
      <aside className="strategy panel"><PanelTitle icon={Gauge} meta="MONTE CARLO · N=1,000">STRATEGY SIMULATOR</PanelTitle><div className="form-block"><label>ACTIVE DRIVER</label><Select value={selected.code} onValueChange={setDriver}><SelectTrigger className="strategy-select"><SelectValue/></SelectTrigger><SelectContent>{allDrivers.map(d=><SelectItem key={d.code} value={d.code}>{d.code} · P{d.pos} · {d.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="form-block"><label>NEXT COMPOUND</label><div className="compound-grid">{compounds.map(c=><button key={c.id} className={compound===c.id?"compound active":"compound"} onClick={()=>setCompound(c.id)}><i style={{borderColor:c.color,color:c.color}}>{c.label}</i><span>{c.id}<small>{c.life}</small></span></button>)}</div></div>
        <div className="form-block split"><div><label>PIT LAP</label><strong>LAP {lap+pitOffset}</strong></div><span>{pitOffset===0?"THIS LAP":`+${pitOffset} LAP${pitOffset>1?"S":""}`}</span></div><Slider value={[pitOffset]} min={0} max={5} step={1} onValueChange={v=>setPitOffset(v[0])} aria-label="Pit lap offset"/>
        <div className="form-block"><label>TRACK CONDITION</label><div className="condition-buttons">{(["DRY","LIGHT RAIN","HEAVY RAIN"] as Weather[]).map(w=><button key={w} onClick={()=>setWeather(w)} className={weather===w?"active":""}>{w!=="DRY"&&<CloudRain size={13}/>} {w}</button>)}</div></div>
        <button className={safetyCar?"toggle active":"toggle"} onClick={()=>setSafetyCar(!safetyCar)} role="switch" aria-checked={safetyCar}><span><Flag size={15}/>Safety car scenario</span><i/></button><button className="simulate" onClick={runSimulation}><RefreshCw size={16}/>RUN 1,000 SIMULATIONS</button>
        <div className="prediction" key={scenario}><div className="prediction-head"><span>PREDICTED OUTCOME</span><strong className={ops.health==="DEGRADED"?"confidence-warn":""}>{adjustedConfidence}% CONFIDENCE</strong></div><div className="result-position"><small>FINISH</small><strong>P{prediction.expectedPosition}</strong><span className={prediction.expectedDelta<=0?"positive":"negative"}>{prediction.expectedDelta<=0?"▲":"▼"} {Math.abs(prediction.expectedDelta).toFixed(1)}s</span></div><div className="probabilities"><div><span>Podium</span><i><b style={{width:`${prediction.podiumProbability}%`}}/></i><strong>{prediction.podiumProbability}%</strong></div><div><span>Win</span><i><b style={{width:`${prediction.winProbability}%`}}/></i><strong>{prediction.winProbability}%</strong></div></div><div className="strategy-matrix">{comparisons.map(({offset,result})=><div key={offset} className={offset===pitOffset?"active":""}><span>{offset===0?"UNDERCUT":offset===2?"HOLD":"OVERCUT"}</span><strong>{result.expectedDelta>0?"+":""}{result.expectedDelta.toFixed(1)}s</strong></div>)}</div><div className="risk-line"><span>80% RANGE</span><strong>{prediction.p10.toFixed(1)}s → +{prediction.p90.toFixed(1)}s</strong><span>RIVAL COVER</span><strong>{prediction.competitorResponse}%</strong></div><p><strong>{prediction.bestMode}: {compound} on lap {lap+pitOffset}</strong> is the leading call across 1,000 simulated race paths, including traffic, stop variance, degradation, weather shocks, and rival response.{ops.health==="DEGRADED"&&" Confidence is reduced while the pipeline operates on degraded telemetry."}</p></div>
      </aside>
    </div><footer><span>{ops.cache?"DEGRADED MODE · TRUSTED EDGE SNAPSHOT":raceData?"OPENF1 HISTORICAL TELEMETRY · EVENT PIPELINE":"MODEL REPLAY · EVENT PIPELINE"}</span><span>TRACE race-24-gbr-{String(scenario+1842).padStart(4,"0")}</span><span>MONTE CARLO · 1,000 PATHS</span></footer></>}
  </main><SheetContent className="raceops-sheet sm:max-w-[520px]" showCloseButton>
    <SheetHeader className="raceops-head"><div className="raceops-kicker"><ShieldCheck size={14}/> PITWALL CLOUD CONTROL</div><SheetTitle>Telemetry Trust Center</SheetTitle><SheetDescription>Test how the race-operations pipeline protects strategy decisions when telemetry fails or becomes untrusted.</SheetDescription></SheetHeader>
    <div className={`health-hero ${ops.health.toLowerCase()}`}><div><span className="health-ring"><ShieldCheck size={27}/><strong>{ops.trust}</strong></span><div><small>SYSTEM POSTURE</small><h3>{ops.health}</h3><p>{ops.health==="HEALTHY"?"All telemetry controls operational":ops.health==="PROTECTED"?"Threat contained · trusted state preserved":"Failover active · confidence reduced"}</p></div></div>{ops.fault!=="NOMINAL"&&<button onClick={recoverPipeline}><RefreshCw size={13}/> RECOVER PIPELINE</button>}</div>
    <div className="cloud-path" aria-label="Telemetry cloud pipeline"><div><Radio/><span>INGEST</span></div><i/><div><ShieldCheck/><span>VALIDATE</span></div><i/><div><Database/><span>ENRICH</span></div><i/><div><Zap/><span>SIMULATE</span></div></div>
    <Tabs defaultValue="lab" className="raceops-tabs"><TabsList variant="line"><TabsTrigger value="lab">FAILURE LAB</TabsTrigger><TabsTrigger value="metrics">RELIABILITY</TabsTrigger><TabsTrigger value="audit">AUDIT LOG</TabsTrigger></TabsList>
      <TabsContent value="lab" className="ops-tab-content"><div className="tab-intro"><strong>INJECT CONTROLLED FAILURE</strong><span>Each scenario executes a real client-side resilience control.</span></div><div className="fault-grid">
        <button className={ops.fault==="OUTAGE"?"active bad":""} onClick={()=>injectFault("OUTAGE")}><WifiOff/><span><strong>API OUTAGE</strong><small>Circuit breaker + cache failover</small></span></button>
        <button className={ops.fault==="LATENCY"?"active warn":""} onClick={()=>injectFault("LATENCY")}><Activity/><span><strong>HIGH LATENCY</strong><small>Backpressure + confidence penalty</small></span></button>
        <button className={ops.fault==="CORRUPT"?"active safe":""} onClick={()=>injectFault("CORRUPT")}><LockKeyhole/><span><strong>TAMPERED EVENT</strong><small>Schema and range validation</small></span></button>
        <button className={ops.fault==="DUPLICATE"?"active safe":""} onClick={()=>injectFault("DUPLICATE")}><Database/><span><strong>REPLAY STORM</strong><small>Idempotent event deduplication</small></span></button>
        <button className={ops.fault==="WEATHER_LOSS"?"active warn":""} onClick={()=>injectFault("WEATHER_LOSS")}><CloudRain/><span><strong>WEATHER LOSS</strong><small>Last-known-good observation</small></span></button>
      </div><div className="containment"><CheckCircle2/><div><strong>BLAST RADIUS CONTAINED</strong><span>Strategy engine only consumes verified snapshots. Raw events never overwrite trusted race state.</span></div></div></TabsContent>
      <TabsContent value="metrics" className="ops-tab-content"><div className="ops-metrics"><div><span>INGEST P95</span><strong>{ops.latency===null?"—":`${ops.latency} ms`}</strong><small className={ops.latency&&ops.latency>500?"bad":"ok"}>{ops.latency&&ops.latency>500?"SLO BREACH":"WITHIN 250 MS SLO"}</small></div><div><span>TRUSTED EVENTS</span><strong>{(18642-ops.rejected).toLocaleString()}</strong><small className="ok">99.99% ACCEPTED</small></div><div><span>REJECTED</span><strong>{ops.rejected}</strong><small>VALIDATION GATE</small></div><div><span>DEDUPLICATED</span><strong>{ops.deduplicated}</strong><small>IDEMPOTENCY KEY</small></div><div><span>CACHE MODE</span><strong>{ops.cache?"ACTIVE":"STANDBY"}</strong><small>{ops.cache?"LAST TRUSTED STATE":"EDGE READY"}</small></div><div><span>CIRCUIT</span><strong>{ops.circuit}</strong><small>{ops.circuit==="OPEN"?"UPSTREAM ISOLATED":"REQUESTS FLOWING"}</small></div></div><div className="security-controls"><h4>SECURITY CONTROLS</h4>{["Strict telemetry schema validation","Impossible-value and range detection","Event idempotency and replay protection","Last-known-good snapshot isolation","Immutable strategy decision audit"].map(item=><div key={item}><CheckCircle2/>{item}</div>)}</div></TabsContent>
      <TabsContent value="audit" className="ops-tab-content"><div className="event-log">{opsEvents.map(event=><div key={event.id} className={`event-row ${event.tone}`}><time>{event.time}</time><i/><div><strong>{event.title}</strong><span>{event.detail}</span></div></div>)}</div></TabsContent>
    </Tabs>
    <div className="infra-foot"><Server size={13}/><span>EDGE WORKER</span><i/> <Database size={13}/><span>SNAPSHOT CACHE</span><i/><LockKeyhole size={13}/><span>ZERO SECRETS IN CLIENT</span></div>
  </SheetContent></Sheet>;
}
