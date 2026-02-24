"""
constants.py
============
Python equivalent of constants.js — single source of truth for all
activity detection thresholds, ship IDs, and probability factors.

Keep in sync with constants.js.
"""

# ─── Timeouts & Thresholds ───────────────────────────────────────────────────

CAMP_TIMEOUT_MS: int = 30 * 60 * 1000  # 30 minutes
ROAM_TIMEOUT_MS: int = 30 * 60 * 1000  # 30 minutes
DECAY_START_MS: int = 13 * 60 * 1000  # 13 minutes

CAPSULE_ID: int = 670
MTU_ID: int = 35834

KM_PER_AU: float = 149_597_870.7

THRESHOLDS = {
    "AT_CELESTIAL": 10_000,  # 10 km
    "DIRECT_WARP": 1_000_000,  # 1,000 km
    "NEAR_CELESTIAL": 10_000_000,  # 10,000 km
    "MAX_BOX_SIZE": KM_PER_AU * 1_000,
    "EPSILON": 0.01,
}

# ─── Smartbomb Weapon IDs ────────────────────────────────────────────────────
# Exact weapon_type_id values from CAMP_PROBABILITY_FACTORS.SMARTBOMB_WEAPONS.
# Only an exact match here should trigger smartbomb classification.

SMARTBOMB_WEAPON_IDS: frozenset[int] = frozenset(
    {
        # Large T1
        3993,
        3977,
        3987,
        3981,
        # Large T2
        3983,
        3989,
        3979,
        3995,
        # Medium T2
        3955,
        3939,
        3949,
        3943,
        # Large EMP — faction / officer / modified
        15963,  # Imperial Navy Large EMP Smartbomb
        28545,  # Khanid Navy Large EMP Smartbomb
        14190,  # True Sansha Large EMP Smartbomb
        14792,  # Vizan's Modified Large EMP Smartbomb
        9678,  # 'Vehemence' Compact Large EMP Smartbomb
        23868,  # 'Warhammer' Large EMP Smartbomb
        14794,  # Ahremen's Modified Large EMP Smartbomb
        15947,  # Ammatar Navy Large EMP Smartbomb
        14784,  # Brokara's Modified Large EMP Smartbomb
        14796,  # Chelm's Modified Large EMP Smartbomb
        14188,  # Dark Blood Large EMP Smartbomb
        14798,  # Draclira's Modified Large EMP Smartbomb
        14790,  # Raysere's Modified Large EMP Smartbomb
        14788,  # Selynne's Modified Large EMP Smartbomb
        14786,  # Tairei's Modified Large EMP Smartbomb
        # Large Proton — faction / modified
        9772,  # 'Notos' Compact Large Proton Smartbomb
        21538,  # 'Regressive' Large Proton Smartbomb
        14208,  # Domination Large Proton Smartbomb
        14548,  # Gotan's Modified Large Proton Smartbomb
        14546,  # Hakim's Modified Large Proton Smartbomb
        14544,  # Mizuro's Modified Large Proton Smartbomb
        15939,  # Republic Fleet Large Proton Smartbomb
        14550,  # Tobias' Modified Large Proton Smartbomb
        # Large Plasma — faction / modified
        15955,  # Federation Navy Large Plasma Smartbomb
        15156,  # Setele's Modified Large Plasma Smartbomb
        14206,  # Shadow Serpentis Large Plasma Smartbomb
        15154,  # Tuvan's Modified Large Plasma Smartbomb
        84496,  # 'Scalding' Large Plasma Smartbomb
        9808,  # 'YF-12a' Compact Large Plasma Smartbomb
        15152,  # Brynn's Modified Large Plasma Smartbomb
        15158,  # Cormack's Modified Large Plasma Smartbomb
        # Large Graviton — faction / modified
        14694,  # Thon's Modified Large Graviton Smartbomb
        14696,  # Vepas' Modified Large Graviton Smartbomb
        84495,  # 'Blasting' Large Graviton Smartbomb
        9668,  # 'Concussion' Compact Large Graviton Smartbomb
        15931,  # Caldari Navy Large Graviton Smartbomb
        14204,  # Dread Guristas Large Graviton Smartbomb
        14698,  # Estamel's Modified Large Graviton Smartbomb
        14692,  # Kaikka's Modified Large Graviton Smartbomb
        # Medium Plasma
        15953,  # Federation Navy Medium Plasma Smartbomb
        14220,  # Shadow Serpentis Medium Plasma Smartbomb
        84498,  # 'Boiling' Medium Plasma Smartbomb
        9800,  # 'YF-12a' Compact Medium Plasma Smartbomb
        # Medium Proton
        14222,  # Domination Medium Proton Smartbomb
        15937,  # Republic Fleet Medium Proton Smartbomb
        21536,  # 'Dwindling' Medium Proton Smartbomb
        9762,  # 'Notos' Compact Medium Proton Smartbomb
        # Medium Graviton
        15929,  # Caldari Navy Medium Graviton Smartbomb
        14210,  # Dread Guristas Medium Graviton Smartbomb
        84497,  # 'Booming' Medium Graviton Smartbomb
        9728,  # 'Concussion' Compact Medium Graviton Smartbomb
        # Medium EMP
        14192,  # Dark Blood Medium EMP Smartbomb
        14194,  # True Sansha Medium EMP Smartbomb
        15961,  # Imperial Navy Medium EMP Smartbomb
        23866,  # 'Lance' Medium EMP Smartbomb
        9734,  # 'Vehemence' Compact Medium EMP Smartbomb
        15945,  # Ammatar Navy Medium EMP Smartbomb
    }
)

# ─── Threat Ships ────────────────────────────────────────────────────────────
# ship_type_id -> probability weight contribution
# Synced from CAMP_PROBABILITY_FACTORS.THREAT_SHIPS

THREAT_SHIPS: dict[int, float] = {
    3756: 0.20,  # Gnosis
    11202: 0.03,  # Ares
    11196: 0.11,  # Stiletto
    11176: 0.04,  # Crow
    11184: 0.03,  # Crusader
    11186: 0.08,  # Malediction
    11200: 0.03,  # Taranis
    11178: 0.04,  # Raptor
    29988: 0.35,  # Proteus
    20125: 0.20,  # Curse
    17722: 0.25,  # Vigilant
    22456: 0.50,  # Sabre
    22464: 0.44,  # Flycatcher
    22452: 0.44,  # Heretic
    22460: 0.44,  # Eris
    12013: 0.40,  # Broadsword
    11995: 0.40,  # Onyx
    12021: 0.40,  # Phobos
    12017: 0.40,  # Devoter
    29984: 0.15,  # Tengu
    29990: 0.29,  # Loki
    11174: 0.30,  # Keres
    35683: 0.05,  # Hecate
    11969: 0.30,  # Arazu
    11961: 0.30,  # Huginn
    11957: 0.04,  # Falcon
    29986: 0.09,  # Legion
    47466: 0.10,  # Praxis
    12038: 0.05,  # Purifier
    12034: 0.05,  # Hound
    17720: 0.12,  # Cynabal
    11963: 0.16,  # Rapier
    12044: 0.08,  # Enyo
    17922: 0.18,  # Ashimmu
    11999: 0.06,  # Vagabond
    85086: 0.04,  # Cenotaph
    33818: 0.03,  # Orthrus
    11971: 0.22,  # Lachesis
    4310: 0.01,  # Tornado
    17738: 0.01,  # Machariel
    11387: 0.03,  # Hyena
}

# Ships that indicate a dedicated smartbomb setup
SMARTBOMB_SHIPS: frozenset[int] = frozenset(
    {
        17738,  # Machariel
        3756,  # Gnosis
        29988,  # Proteus
        47466,  # Praxis
    }
)

# ─── Permanent Camp Locations ────────────────────────────────────────────────
# system_id -> {gates: list[str], weight: float}
# Synced from CAMP_PROBABILITY_FACTORS.PERMANENT_CAMPS

PERMANENT_CAMPS: dict[int, dict] = {
    30002813: {"gates": ["Nourvukaiken", "Kedama"], "weight": 0.50},  # Tama
    30003068: {"gates": ["Miroitem", "Crielere"], "weight": 0.50},  # Rancer
    30000142: {"gates": ["Perimeter"], "weight": 0.25},  # Jita
    30002647: {"gates": ["Iyen-Oursta"], "weight": 0.30},  # Ignoitton
    30005196: {"gates": ["Shera"], "weight": 0.40},  # Ahbazon
}

# ─── Probability factor constants ────────────────────────────────────────────

THREAT_SCORE_CAP = 0.50
CONSISTENCY_BONUS = 0.15
MAX_CONSISTENCY_BONUS = 0.30
WIDELY_SPACED_BONUS = 0.15
MAX_WIDELY_SPACED_BONUS = 0.45
POD_BONUS_PER_KILL = 0.03
MAX_POD_BONUS = 0.15
BURST_PENALTY = 0.20
OVERALL_PROB_CAP = 0.95
MIN_PROB_THRESHOLD = 5  # percent — below this = 0
DECAY_RATE_PER_MIN = 0.10
BATTLE_PARTICIPANT_THRESHOLD = 40
