export type RaceKey = "silverstone" | "monaco" | "monza" | "spa" | "singapore";

export interface RaceConfig {
  key: RaceKey;
  label: string;
  country: string;
  circuit: string;
  year: number;
  pitLoss: number;
  trafficScale: number;
  overtakeDifficulty: number;
  safetyCarProbability: number;
  character: string;
}

export const RACES:RaceConfig[] = [
  {key:"silverstone",label:"British GP",country:"Great Britain",circuit:"Silverstone",year:2024,pitLoss:21.8,trafficScale:1.0,overtakeDifficulty:0.78,safetyCarProbability:34,character:"High-speed balance and changeable weather"},
  {key:"monaco",label:"Monaco GP",country:"Monaco",circuit:"Monaco",year:2024,pitLoss:19.6,trafficScale:1.55,overtakeDifficulty:1.85,safetyCarProbability:62,character:"Track position dominates; overtaking is severely constrained"},
  {key:"monza",label:"Italian GP",country:"Italy",circuit:"Monza",year:2024,pitLoss:24.2,trafficScale:0.82,overtakeDifficulty:0.62,safetyCarProbability:28,character:"Low drag, high pit loss, and strong overtaking potential"},
  {key:"spa",label:"Belgian GP",country:"Belgium",circuit:"Spa-Francorchamps",year:2024,pitLoss:22.7,trafficScale:0.92,overtakeDifficulty:0.68,safetyCarProbability:38,character:"Long lap, weather variance, and large pace differentials"},
  {key:"singapore",label:"Singapore GP",country:"Singapore",circuit:"Singapore",year:2024,pitLoss:28.1,trafficScale:1.32,overtakeDifficulty:1.36,safetyCarProbability:78,character:"High degradation with a strong neutralization probability"},
];

export const raceByKey = (key:RaceKey) => RACES.find(race=>race.key===key) ?? RACES[0];
