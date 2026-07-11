/**
 * Public open-data catalogue · verbatim from _mockups/01-public.html
 * L1692-1705. Each entry maps to a k-anonymised public-tier mart.
 */
export type Dataset = {
  id: string;
  title: string;
  topic: string;
  tier: 'aggregate' | 'facility-level' | 'bulletin';
  period: string;
  formats: string[];
  sizeMb: number;
  updated: string;
  downloads: number;
  doi: string;
  desc: string;
};

export const DATASETS: Dataset[] = [
  { id:'D-001', title:'National coverage indicators by region', topic:'EPI · MNCH · HIV · TB', tier:'aggregate', period:'2024-Q1 → 2026-Q2', formats:['CSV','JSON','XLSX'], sizeMb:4.2, updated:'2026-06-21', downloads:1247, doi:'10.x/nhdw/D-001', desc:'Quarterly figures for eight flagship health indicators across every region, from early 2024 to the middle of 2026. This is the dataset that fed the HSTP-II midterm review.' },
  { id:'D-002', title:'Facility distribution by region × tier', topic:'Health facilities', tier:'aggregate', period:'2026-Q2', formats:['CSV','GeoJSON'], sizeMb:1.8, updated:'2026-06-20', downloads:892, doi:'10.x/nhdw/D-002', desc:'A current count of every health post, health centre, and primary and general hospital in each region, each with its map coordinates. Reflects the second quarter of 2026.' },
  { id:'D-003', title:'PHEM weekly IDSR bulletins', topic:'Surveillance', tier:'bulletin', period:'2023-W01 → 2026-W24', formats:['PDF','JSON'], sizeMb:76, updated:'2026-06-19', downloads:3104, doi:'10.x/nhdw/D-003', desc:'Every weekly notifiable-disease bulletin PHEM has published since the start of 2023, through to mid-2026. Read them as PDFs, or pull the same figures as JSON for analysis.' },
  { id:'D-004', title:'Routine immunisation coverage by antigen', topic:'EPI', tier:'aggregate', period:'2024 → 2026', formats:['CSV','XLSX'], sizeMb:12, updated:'2026-06-18', downloads:680, doi:'10.x/nhdw/D-004', desc:'Monthly immunisation coverage by region for the full childhood schedule, from BCG and the Penta series through measles, IPV, PCV, rotavirus and HPV. Covers 2024 to 2026.' },
  { id:'D-005', title:'NCD prevalence: STEPS 2023', topic:'NCD', tier:'aggregate', period:'2023', formats:['XLSX','PDF'], sizeMb:3.4, updated:'2026-04-12', downloads:512, doi:'10.x/nhdw/D-005', desc:'The 2023 WHO STEPS survey of noncommunicable-disease risk factors, covering raised blood pressure, diabetes, tobacco and alcohol use, and physical activity.' },
  { id:'D-006', title:'Maternal mortality ratio · 2019-2025', topic:'MNCH', tier:'aggregate', period:'2019 → 2025', formats:['CSV','XLSX'], sizeMb:0.9, updated:'2026-03-15', downloads:778, doi:'10.x/nhdw/D-006', desc:'Maternal mortality by region, given per 100,000 live births, for the years 2019 to 2025. Built from civil registration together with a facility delivery audit.' },
  { id:'D-007', title:'Cold-chain incident log', topic:'Supply chain', tier:'aggregate', period:'2024 → 2026', formats:['CSV','JSON'], sizeMb:2.1, updated:'2026-06-15', downloads:233, doi:'10.x/nhdw/D-007', desc:'A de-identified log of cold-chain temperature excursions recorded at facilities between 2024 and 2026. The raw material for cold-chain quality-improvement studies.' },
  { id:'D-008', title:'EWARS+ woreda alarm-probability series', topic:'Surveillance', tier:'aggregate', period:'2022-W01 → 2026-W24', formats:['CSV','Parquet'], sizeMb:48, updated:'2026-06-22', downloads:418, doi:'10.x/nhdw/D-008', desc:'Weekly outbreak-alarm probabilities for all 1,148 woredas, adjusted for local rainfall and temperature, running from 2022 to the middle of 2026. Curated by EPHI for forecasting research.' },
  { id:'D-009', title:'TB cohort outcomes: 2024 register', topic:'TB', tier:'aggregate', period:'2024', formats:['CSV','XLSX'], sizeMb:1.3, updated:'2026-02-28', downloads:357, doi:'10.x/nhdw/D-009', desc:'TB treatment outcomes by region for the 2024 cohort, showing treatment success, failure and loss to follow-up, with drug-resistant TB reported separately.' },
  { id:'D-010', title:'Health workforce density', topic:'Workforce', tier:'aggregate', period:'2024 → 2026', formats:['CSV','XLSX'], sizeMb:0.6, updated:'2026-05-30', downloads:289, doi:'10.x/nhdw/D-010', desc:'Health-workforce density by region for 2024 to 2026, counting doctors, nurses, midwives and pharmacists per 10,000 people.' },
  { id:'D-011', title:'HIV treatment cascade by region', topic:'HIV', tier:'aggregate', period:'2020 → 2025', formats:['CSV','XLSX'], sizeMb:1.1, updated:'2026-05-22', downloads:842, doi:'10.x/nhdw/D-011', desc:'The HIV treatment cascade by region from 2020 to 2025, tracking diagnosis, treatment coverage, retention and viral suppression against the 95-95-95 targets.' },
  { id:'D-012', title:'Population denominators by woreda (CSA estimates)', topic:'Population', tier:'aggregate', period:'2024 estimate', formats:['CSV','GeoJSON'], sizeMb:1.6, updated:'2026-01-15', downloads:1582, doi:'10.x/nhdw/D-012', desc:'Central Statistical Agency mid-year population estimates for 2024, broken down by woreda, age and sex. These are the denominators behind every coverage figure on this portal.' },
];

export const TOPICS = ['EPI', 'MNCH', 'HIV', 'TB', 'NCD', 'Surveillance', 'Supply chain', 'Workforce', 'Population', 'Health facilities'];
