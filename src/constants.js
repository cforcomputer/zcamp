// Contains all the static id codes

export const CAMP_TIMEOUT = 40 * 60 * 1000; // 40 minutes
export const DECAY_START = 20 * 60 * 1000; // 20 minutes
export const CAPSULE_ID = 670;

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
    14210: "Large EMP Smartbomb I",
    14208: "Large Proton Smartbomb I",
    14212: "Large Plasma Smartbomb I",
    14214: "Large Electron Smartbomb I",
    14216: "Large Gamma Smartbomb I",
    14209: "Large EMP Smartbomb II",
    14207: "Large Proton Smartbomb II",
    14211: "Large Plasma Smartbomb II",
    14213: "Large Electron Smartbomb II",
    14215: "Large Gamma Smartbomb II",
    14269: "Domination Large EMP Smartbomb",
    14271: "Dark Blood Large EMP Smartbomb",
    14273: "True Sansha Large EMP Smartbomb",
    14275: "Shadow Serpentis Large Electron Smartbomb",
    14277: "Dread Guristas Large Proton Smartbomb",
    14279: "Republic Fleet Large EMP Smartbomb",
    14281: "Caldari Navy Large Proton Smartbomb",
    14283: "Imperial Navy Large EMP Smartbomb",
    14285: "Federation Navy Large Electron Smartbomb",
    14202: "Medium EMP Smartbomb I",
    14200: "Medium Proton Smartbomb I",
    14204: "Medium Plasma Smartbomb I",
    14206: "Medium Electron Smartbomb I",
    14198: "Medium Gamma Smartbomb I",
    14201: "Medium EMP Smartbomb II",
    14199: "Medium Proton Smartbomb II",
    14203: "Medium Plasma Smartbomb II",
    14205: "Medium Electron Smartbomb II",
    14197: "Medium Gamma Smartbomb II",
    14268: "Domination Medium EMP Smartbomb",
    14270: "Dark Blood Medium EMP Smartbomb",
    14272: "True Sansha Medium EMP Smartbomb",
    14274: "Shadow Serpentis Medium Electron Smartbomb",
    14276: "Dread Guristas Medium Proton Smartbomb",
    14278: "Republic Fleet Medium EMP Smartbomb",
    14280: "Caldari Navy Medium Proton Smartbomb",
    14282: "Imperial Navy Medium EMP Smartbomb",
    14284: "Federation Navy Medium Electron Smartbomb",
  },

  THREAT_SHIPS: {
    3756: { weight: 0.15 }, // gnosis
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
    47466: { weight: 0.06 }, // Praxis
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
