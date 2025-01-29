// Contains all the static id codes

export const CAMP_TIMEOUT = 40 * 60 * 1000; // 40 minutes
export const DECAY_START = 20 * 60 * 1000; // 20 minutes
export const CAPSULE_ID = 670;

//server.js AU
export const KM_PER_AU = 149597870.7;

export const SALVAGE_VALUES = {
  frigate: 3_000_000,
  destroyer: 6_000_000,
  cruiser: 12_000_000,
  battlecruiser: 25_000_000,
  battleship: 40_000_000,
  industrial: 5_000_000,
  mining: 5_000_000,
  capital: 100_000_000,
  structure: 50_000_000,
  // Default to frigate value for unknown types
  unknown: 3_000_000,
};

export const THRESHOLDS = {
  AT_CELESTIAL: 10000, // 10km
  DIRECT_WARP: 1000000, // 1000km
  NEAR_CELESTIAL: 10000000, // 10,000km
  MAX_BOX_SIZE: KM_PER_AU * 1000,
  EPSILON: 0.01,
};

export const CAMP_PROBABILITY_FACTORS = {
  BASE: {
    SINGLE_KILL: 0.3,
    MULTI_KILL: 0.5,
    INITIAL_BURST: -0.2,
  },

  TIME_WEIGHTS: {
    INACTIVITY: {
      start: 20,
      penalty: -0.35,
      decayPerMinute: 0.2,
    },
    ESTABLISHED: { threshold: 60, bonus: 0.2 },
    SUSTAINED: { threshold: 120, bonus: 0.3 },
    FATIGUE: { threshold: 180, penalty: -0.2 },
  },

  SMARTBOMB_WEAPONS: {
    3993: "Large EMP Smartbomb I",
    3977: "Large Proton Smartbomb I",
    3987: "Large Plasma Smartbomb I",
    3981: "Large Graviton Smartbomb I",
    3983: "Large Graviton Smartbomb II",
    3989: "Large Plasma Smartbomb II",
    3979: "Large Proton Smartbomb II",
    3995: "Large EMP Smartbomb II",
    3955: "Medium EMP Smartbomb II",
    3939: "Medium Proton Smartbomb II",
    3949: "Medium Plasma Smartbomb II",
    3943: "Medium Graviton Smartbomb II",
    15963: "Imperial Navy Large EMP Smartbomb",
    28545: "Khanid Navy Large EMP Smartbomb",
    14190: "True Sansha Large EMP Smartbomb",
    14792: "Vizan's Modified Large EMP Smartbomb",
    9678: "'Vehemence' Compact Large EMP Smartbomb",
    23868: "'Warhammer' Large EMP Smartbomb",
    14794: "Ahremen's Modified Large EMP Smartbomb",
    15947: "Ammatar Navy Large EMP Smartbomb",
    14784: "Brokara's Modified Large EMP Smartbomb",
    14796: "Chelm's Modified Large EMP Smartbomb",
    14188: "Dark Blood Large EMP Smartbomb",
    14798: "Draclira's Modified Large EMP Smartbomb",
    14790: "Raysere's Modified Large EMP Smartbomb",
    14788: "Selynne's Modified Large EMP Smartbomb",
    14786: "Tairei's Modified Large EMP Smartbomb",
    9772: "'Notos' Compact Large Proton Smartbomb",
    21538: "'Regressive' Large Proton Smartbomb",
    14208: "Domination Large Proton Smartbomb",
    14548: "Gotan's Modified Large Proton Smartbomb",
    14546: "Hakim's Modified Large Proton Smartbomb",
    14544: "Mizuro's Modified Large Proton Smartbomb",
    15939: "Republic Fleet Large Proton Smartbomb",
    14550: "Tobias' Modified Large Proton Smartbomb",
    15955: "Federation Navy Large Plasma Smartbomb",
    15156: "Setele's Modified Large Plasma Smartbomb",
    14206: "Shadow Serpentis Large Plasma Smartbomb",
    15154: "Tuvan's Modified Large Plasma Smartbomb",
    84496: "'Scalding' Large Plasma Smartbomb",
    9808: "'YF-12a' Compact Large Plasma Smartbomb",
    15152: "Brynn's Modified Large Plasma Smartbomb",
    15158: "Cormack's Modified Large Plasma Smartbomb",
    14694: "Thon's Modified Large Graviton Smartbomb",
    14696: "Vepas' Modified Large Graviton Smartbomb",
    84495: "'Blasting' Large Graviton Smartbomb",
    9668: "'Concussion' Compact Large Graviton Smartbomb",
    15931: "Caldari Navy Large Graviton Smartbomb",
    14204: "Dread Guristas Large Graviton Smartbomb",
    14698: "Estamel's Modified Large Graviton Smartbomb",
    14692: "Kaikka's Modified Large Graviton Smartbomb",
    14694: "Thon's Modified Large Graviton Smartbomb",
    14696: "Vepas' Modified Large Graviton Smartbomb",
    15953: "Federation Navy Medium Plasma Smartbomb",
    14220: "Shadow Serpentis Medium Plasma Smartbomb",
    84498: "'Boiling' Medium Plasma Smartbomb",
    9800: "'YF-12a' Compact Medium Plasma Smartbomb",
    14222: "Domination Medium Proton Smartbomb",
    15937: "Republic Fleet Medium Proton Smartbomb",
    21536: "'Dwindling' Medium Proton Smartbomb",
    9762: "'Notos' Compact Medium Proton Smartbomb",
    15929: "Caldari Navy Medium Graviton Smartbomb",
    14210: "Dread Guristas Medium Graviton Smartbomb",
    84497: "'Booming' Medium Graviton Smartbomb",
    9728: "'Concussion' Compact Medium Graviton Smartbomb",
    14192: "Dark Blood Medium EMP Smartbomb",
    14194: "True Sansha Medium EMP Smartbomb",
    15961: "Imperial Navy Medium EMP Smartbomb",
    23866: "'Lance' Medium EMP Smartbomb",
    9734: "'Vehemence' Compact Medium EMP Smartbomb",
    15945: "Ammatar Navy Medium EMP Smartbomb",
  },

  THREAT_SHIPS: {
    3756: { weight: 0.2 }, // gnosis
    11202: { weight: 0.03 }, // ares
    11196: { weight: 0.11 }, // stiletto
    11176: { weight: 0.04 }, // crow
    11184: { weight: 0.03 }, // crusader
    11186: { weight: 0.08 }, // malediction
    11200: { weight: 0.03 }, // Taranis
    11178: { weight: 0.04 }, // raptor
    29988: { weight: 0.35 }, // proteus
    20125: { weight: 0.2 }, // Curse
    17722: { weight: 0.25 }, // Vigilant
    22456: { weight: 0.5 }, // Sabre
    22464: { weight: 0.44 }, // Flycatcher
    22452: { weight: 0.44 }, // Heretic
    22460: { weight: 0.44 }, // Eris
    12013: { weight: 0.4 }, // Broadsword
    11995: { weight: 0.4 }, // Onyx
    12021: { weight: 0.4 }, // Phobos
    12017: { weight: 0.4 }, // Devoter
    29984: { weight: 0.15 }, // Tengu
    29990: { weight: 0.29 }, // Loki
    11174: { weight: 0.3 }, // Keres
    35683: { weight: 0.13 }, // Hecate
    11969: { weight: 0.3 }, // Arazu
    11961: { weight: 0.3 }, // Huginn
    11957: { weight: 0.04 }, // Falcon
    29986: { weight: 0.09 }, // Legion
    47466: { weight: 0.1 }, // Praxis
    12038: { weight: 0.05 }, // Purifier
    12034: { weight: 0.05 }, // hound
    17720: { weight: 0.12 }, // Cynabal
    11963: { weight: 0.16 }, // Rapier
    12044: { weight: 0.08 }, // enyo
    17922: { weight: 0.18 }, // Ashimmu
    11999: { weight: 0.06 }, // Vagabond
    85086: { weight: 0.04 }, // Cenotaph
    33818: { weight: 0.03 }, // Orthrus
    11971: { weight: 0.22 }, // Lachesis
    4310: { weight: 0.01 }, // Tornado
    17738: { weight: 0.01 }, // Machariel
    11387: { weight: 0.03 }, // Hyena
  },

  SMARTBOMB_SHIPS: {
    17738: "Machariel",
    3756: "Gnosis",
    29988: "Proteus",
    47466: "Praxis",
  },

  SHIP_CATEGORIES: {
    INDUSTRIAL: "industrial",
    MINING: "mining",
    CONCORD: "concord",
    NPC: "npc",
  },

  PERMANENT_CAMPS: {
    30002813: { gates: ["Nourvukaiken", "Kedama"], weight: 0.5 }, // Tama
    30003068: { gates: ["Miroitem", "Crielere"], weight: 0.5 }, // Rancer
    30000142: { gates: ["Perimeter"], weight: 0.25 }, // Jita
    30002647: { gates: ["Iyen-Oursta"], weight: 0.3 }, // Ignoitton
    30005196: { gates: ["Shera"], weight: 0.4 }, // Ahbazon
  },

  CONSISTENCY: {
    SAME_CHARS: 0.25,
    SAME_CORPS: 0.15,
    TIME_WINDOW: 1800000,
  },
};

export const DEFAULT_SETTINGS = {
  dropped_value_enabled: false,
  total_value_enabled: false,
  points_enabled: false,
  npc_only: false,
  solo: false,
  awox_only: false,
  location_filter_enabled: false,
  ship_type_filter_enabled: false,
  time_threshold_enabled: false,
  audio_alerts_enabled: false,
  attacker_alliance_filter_enabled: false,
  attacker_corporation_filter_enabled: false,
  attacker_capital_filter_enabled: false,
  attacker_ship_type_filter_enabled: false,
  victim_alliance_filter_enabled: false,
  victim_corporation_filter_enabled: false,
  solar_system_filter_enabled: false,
  item_type_filter_enabled: false,

  // Triangulation settings
  triangulation_filter_enabled: false,
  triangulation_filter_exclude: false,
  triangulation_filter_near_stargate: false,
  triangulation_filter_near_celestial: false,
  triangulation_at_celestial: false,
  triangulation_direct_warp: false,
  triangulation_near_celestial: false,
  triangulation_via_bookspam: false,
  triangulation_none: false,

  webhook_enabled: false,
  webhook_url: "",

  // location type/new filters
  location_type_filter_enabled: false,
  location_types: {
    highsec: false,
    lowsec: false,
    nullsec: false,
    wspace: false,
    abyssal: false,
  },
  combat_label_filter_enabled: false,
  combat_labels: {
    ganked: false,
    pvp: false,
    padding: false,
  },
};
