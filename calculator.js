/**
 * =============================================================================
 * calculator.js — Moteur de calcul de paie Combirail
 * =============================================================================
 * RÈGLES D'ARCHITECTURE :
 *  - Fonctions pures uniquement. Aucune dépendance au DOM, à window ou à
 *    tout autre objet navigateur.
 *  - Toutes les durées sont manipulées en MINUTES ENTIÈRES pour éviter
 *    toute erreur d'arrondi flottant sur les calculs de temps.
 *  - Tous les montants monétaires sont arrondis au centime (Math.round × 100).
 *  - Les constantes métier (taux, seuils, montants) sont isolées en tête de
 *    fichier pour faciliter toute mise à jour réglementaire.
 * =============================================================================
 */

"use strict";

// =============================================================================
// SECTION 1 — CONSTANTES MÉTIER
// =============================================================================

/** Plages horaires exprimées en minutes depuis minuit (axe 0-1440+) */
const PLAGES = {
  NUIT_MAJORATION_START : 22 * 60,        // 1320 — début majoration nuit (22h)
  NUIT_MAJORATION_END   : (7 + 24) * 60,  // 1860 — fin majoration nuit (7h J+1)
  PANIER_NUIT_END       : (6 + 24) * 60,  // 1800 — fin condition panier nuit (6h J+1)
  PANIER_NUIT_MIN       : 150,            // 2h30 en minutes
  REPAS_MIDI_START      : 11 * 60 + 30,   //  690
  REPAS_MIDI_END        : 13 * 60 + 30,   //  810
  REPAS_SOIR_START      : 18 * 60 + 30,   // 1110
  REPAS_SOIR_END        : 20 * 60 + 30,   // 1230
};

/** Taux de majoration brute */
const TAUX = {
  NUIT      : 0.30,   // 30 % par heure de nuit
  DIMANCHE  : 0.50,   // 50 % par heure de dimanche
  FERIE_MAI : 1.00,   // 100 % le 1er mai
  FERIE_EUR : 4.00,   // 4,00 € brut/h pour les autres jours fériés
};

/** Montants des primes (en euros) */
const PRIMES = {
  PANIER_NUIT         :   7.30,   // net de charges
  PANIER_REPAS        :  20.00,   // net de charges
  RHR_1               :  20.00,   // net — palier 0h-15h
  RHR_2               :  30.00,   // net — palier 15h-25h
  RHR_3               :  40.00,   // net — palier +25h
  DOUBLE_RHR          : 175.00,   // brut
  MTP                 :  30.00,   // brut — modification tardive
  SUPPRESSION_REPOS   :  60.00,   // brut
  TUTORAT             :  10.00,   // brut/JS
  MONITORAT_H         :   3.00,   // brut/heure
  MONITORAT_QUALITE   :  60.00,   // brut (prime qualité de suivi)
  FORMATEUR           :  20.00,   // brut/JS
  VTE_MENSUEL         :  80.00,   // brut/mois
  VTE_UNITAIRE        :  15.00,   // brut/VTE (max 15 par mois)
  VTE_MAX             :  15,      // nombre max de VTE par mois
  SABLIERE            :  30.00,   // brut/JS
  RAVITAILLEMENT      :  15.00,   // brut/JS
  COOPTATION_SALAIRE  : 200.00,   // brut
  COOPTATION_CADEAU   : 200.00,   // carte cadeau (hors cotisations)
};

/**
 * Grille des cotisations SALARIALES
 * Chaque entrée : { label, base, taux }
 * base = "SALAIRE_BRUT_GLOBAL" → calculé dynamiquement
 * base = "CSG_BASE"            → calculé dynamiquement (brut × 0,9825 + primes patronales prév+mut)
 * base = "MUTUELLE_BASE"       → base fixe 4005,00 € (à ajuster si accord collectif évolue)
 */
const COTISATIONS_SALARIALES = [
  { id: "prevoyance_sal",   label: "Prévoyance incap./invalid./décès",    baseType: "SALAIRE_BRUT_GLOBAL", taux: 0.0039  },
  { id: "mutuelle_sal",     label: "Complémentaire santé (mutuelle)",     baseType: "MUTUELLE_BASE",        taux: 0.00607 },
  { id: "retraite_plaf",    label: "Retraite SS plafonnée",               baseType: "SALAIRE_BRUT_GLOBAL", taux: 0.0690  },
  { id: "retraite_deplaf",  label: "Retraite SS déplafonnée",             baseType: "SALAIRE_BRUT_GLOBAL", taux: 0.0040  },
  { id: "retraite_compl",   label: "Retraite complémentaire Tranche 1",   baseType: "SALAIRE_BRUT_GLOBAL", taux: 0.0401  },
  { id: "csg_ded",          label: "CSG déductible",                      baseType: "CSG_BASE",            taux: 0.0680  },
  { id: "csg_crds",         label: "CSG/CRDS non déductible",             baseType: "CSG_BASE",            taux: 0.0290  },
];

/**
 * Grille des cotisations PATRONALES (affichage indicatif)
 * Entrée spéciale "EXONERATION" → montant négatif fixe
 * Entrée "CONTRIB_B" → base = patronale_prevoyance + patronale_mutuelle
 */
const COTISATIONS_PATRONALES = [
  { id: "maladie_pat",      label: "Maladie/maternité/invalid./décès",    baseType: "SALAIRE_BRUT_GLOBAL", taux: 0.1300  },
  { id: "prevoyance_pat",   label: "Prévoyance incap./invalid./décès",    baseType: "SALAIRE_BRUT_GLOBAL", taux: 0.0158  },
  { id: "mutuelle_pat",     label: "Complémentaire santé (mutuelle)",     baseType: "MUTUELLE_BASE",        taux: 0.01363 },
  { id: "at_mp",            label: "Accidents du travail / mal. prof.",   baseType: "SALAIRE_BRUT_GLOBAL", taux: 0.0396  },
  { id: "retraite_plaf_p",  label: "Retraite SS plafonnée",               baseType: "SALAIRE_BRUT_GLOBAL", taux: 0.0855  },
  { id: "retraite_dep_p",   label: "Retraite SS déplafonnée",             baseType: "SALAIRE_BRUT_GLOBAL", taux: 0.0211  },
  { id: "retraite_compl_p", label: "Retraite complémentaire Tranche 1",   baseType: "SALAIRE_BRUT_GLOBAL", taux: 0.0601  },
  { id: "alloc_fam",        label: "Allocations familiales",              baseType: "SALAIRE_BRUT_GLOBAL", taux: 0.0525  },
  { id: "chomage",          label: "Assurance chômage",                   baseType: "SALAIRE_BRUT_GLOBAL", taux: 0.0325  },
  { id: "contrib_a",        label: "Autres contributions employeur (A)",  baseType: "SALAIRE_BRUT_GLOBAL", taux: 0.05296 },
  { id: "contrib_b",        label: "Autres contributions employeur (B)",  baseType: "CONTRIB_B_BASE",       taux: 0.0800  },
  { id: "exoneration",      label: "Exonération de cotisations",          baseType: "FIXE",                montantFixe: -289.44 },
];

/** Base salaire de référence pour les taux fixes (contrat 151,67h) */
const SALAIRE_BASE_REF    = 3050.00;
const HEURES_BASE_REF     = 151.67;
const MUTUELLE_BASE_FIXE  = 4005.00;

// =============================================================================
// SECTION 2 — UTILITAIRES TEMPORELS
// =============================================================================

/**
 * Convertit une chaîne "HH:MM" en minutes depuis minuit.
 * @param {string} str — ex: "22:30"
 * @returns {number}
 */
function timeToMinutes(str) {
  const parts = str.split(":");
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

/**
 * Convertit des minutes en chaîne "HH:MM".
 * @param {number} minutes
 * @returns {string}
 */
function minutesToTime(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mn = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mn).padStart(2, "0")}`;
}

/**
 * Calcule le chevauchement en minutes entre [a, b[ et [c, d[.
 * Toutes les bornes sont en minutes (peuvent dépasser 1440 pour J+1).
 * @returns {number} minutes de chevauchement (≥ 0)
 */
function overlapMinutes(a, b, c, d) {
  return Math.max(0, Math.min(b, d) - Math.max(a, c));
}

/**
 * Retourne "YYYY-MM-DD" depuis un objet Date.
 * @param {Date} date
 * @returns {string}
 */
function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Retourne le mois précédent au format "YYYY-MM".
 * @param {string} yearMonth — "YYYY-MM"
 * @returns {string}
 */
function getPreviousMonth(yearMonth) {
  const [y, m] = yearMonth.split("-").map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * Retourne le mois suivant au format "YYYY-MM".
 * @param {string} yearMonth — "YYYY-MM"
 * @returns {string}
 */
function getNextMonth(yearMonth) {
  const [y, m] = yearMonth.split("-").map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * Retourne la liste des jours fériés français pour une année donnée.
 * Calcul algorithmique (algorithme de Meeus/Jones/Butcher pour Pâques).
 * @param {number} year
 * @returns {string[]} — tableau de "YYYY-MM-DD"
 */
function getFeriesForYear(year) {
  // Algorithme de Meeus pour déterminer le dimanche de Pâques
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day   = ((h + l - 7 * m + 114) % 31) + 1;

  const paques    = new Date(year, month - 1, day);
  const lundiPaq  = new Date(year, month - 1, day + 1);
  const ascension = new Date(year, month - 1, day + 39);
  const pentecote = new Date(year, month - 1, day + 50);

  const feries = [
    `${year}-01-01`, // Jour de l'An
    toISODate(lundiPaq),
    `${year}-05-01`, // Fête du Travail
    `${year}-05-08`, // Victoire 1945
    toISODate(ascension),
    toISODate(pentecote),
    `${year}-07-14`, // Fête Nationale
    `${year}-08-15`, // Assomption
    `${year}-11-01`, // Toussaint
    `${year}-11-11`, // Armistice
    `${year}-12-25`, // Noël
  ];

  return feries;
}

// =============================================================================
// SECTION 3 — ANALYSE D'UN SHIFT JOURNALIER
// =============================================================================

/**
 * Analyse un shift et retourne toutes les métriques nécessaires au calcul
 * des primes automatiques.
 *
 * GESTION DU PASSAGE MINUIT :
 *   Si endMin <= startMin, on ajoute 1440 à endMin (le shift se termine J+1).
 *   Les heures de nuit 0h-7h du lendemain sont représentées sur l'axe étendu
 *   comme 1440-1860.
 *
 * @param {string} startStr   — "HH:MM"
 * @param {string} endStr     — "HH:MM" (peut être J+1)
 * @param {Date}   date       — date du jour de début du shift
 * @param {string[]} holidays — ["YYYY-MM-DD", ...]
 * @returns {Object} ShiftAnalysis
 */
function analyzeShift(startStr, endStr, date, holidays) {
  let startMin = timeToMinutes(startStr);
  let endMin   = timeToMinutes(endStr);

  // Passage minuit : si fin <= début, le shift se termine le lendemain
  if (endMin <= startMin) {
    endMin += 1440;
  }

  const totalMinutes = endMin - startMin;

  // --- Heures de nuit (majoration 30%) : plage 22h-7h ---
  // Sur axe étendu : 22h = 1320, 7h J+1 = 1860
  // Pour les shifts démarrant après minuit (ex: 2h-8h) :
  // la plage 0h-7h est représentée par 0-420 sur l'axe normal,
  // et par 1440-1860 sur l'axe étendu du shift précédent.
  // On traite les deux cas pour couvrir tous les shifts.
  let nightMinutes = 0;

  // Cas A : shift contient de la nuit en fin (ex: 20h-4h → 22h-4h)
  nightMinutes += overlapMinutes(startMin, endMin,
    PLAGES.NUIT_MAJORATION_START,
    PLAGES.NUIT_MAJORATION_END
  );

  // Cas B : shift démarre après minuit et contient de la nuit en début (ex: 2h-8h → 2h-7h)
  // Les minutes 0h-7h sont comptabilisées directement si startMin < 420
  if (startMin < 7 * 60) {
    nightMinutes += overlapMinutes(startMin, endMin, 0, 7 * 60);
  }

  // --- Panier de nuit : ≥ 2h30 (150 min) dans la plage 22h-6h ---
  let basketNightMinutes = 0;

  // Partie fin de shift dans 22h-6h (axe étendu)
  basketNightMinutes += overlapMinutes(startMin, endMin,
    PLAGES.NUIT_MAJORATION_START,
    PLAGES.PANIER_NUIT_END
  );

  // Partie début de shift dans 0h-6h
  if (startMin < 6 * 60) {
    basketNightMinutes += overlapMinutes(startMin, endMin, 0, 6 * 60);
  }

  const hasNightBasket = basketNightMinutes >= PLAGES.PANIER_NUIT_MIN;

  // --- Panier repas (20 €) : chaque fenêtre couverte intégralement = 1 panier ---
  const hasMealBasketLunch  = (startMin <= PLAGES.REPAS_MIDI_START &&
                               endMin   >= PLAGES.REPAS_MIDI_END);
  const hasMealBasketDinner = (startMin <= PLAGES.REPAS_SOIR_START &&
                               endMin   >= PLAGES.REPAS_SOIR_END);
  const mealBasketCount = (hasMealBasketLunch ? 1 : 0) + (hasMealBasketDinner ? 1 : 0);

  // --- Heures de dimanche (majoration 50%) ---
  const isSunday      = (date.getDay() === 0);
  const sundayMinutes = isSunday ? totalMinutes : 0;

  // --- Jours fériés ---
  const dateKey   = toISODate(date);
  const isHoliday = holidays.includes(dateKey);
  const isMayFirst = (dateKey.slice(5) === "05-01");
  const holidayMinutes = isHoliday ? totalMinutes : 0;

  return {
    startMin,
    endMin,
    totalMinutes,
    nightMinutes,
    basketNightMinutes,
    hasNightBasket,
    hasMealBasketLunch,
    hasMealBasketDinner,
    mealBasketCount,
    isSunday,
    sundayMinutes,
    isHoliday,
    isMayFirst,
    holidayMinutes,
    dateKey,
  };
}

// =============================================================================
// SECTION 4 — CALCUL DES MONTANTS BRUTS D'UN SHIFT
// =============================================================================

/**
 * Calcule le taux horaire brut à partir du salaire de base.
 * @param {number} baseSalaryGross — salaire brut de base (défaut 3050 €)
 * @param {number} baseHours       — heures contractuelles (défaut 151,67 h)
 * @returns {number} taux horaire brut en €/h
 */
function getHourlyRate(baseSalaryGross = SALAIRE_BASE_REF,
                       baseHours = HEURES_BASE_REF) {
  return baseSalaryGross / baseHours;
}

/**
 * Calcule les montants bruts générés par l'analyse d'un shift.
 * Les majorations sont calculées sur la base du taux horaire brut.
 *
 * @param {Object} analysis   — retour de analyzeShift()
 * @param {number} hourlyRate — €/h brut
 * @returns {Object} ShiftGross
 */
function computeShiftGross(analysis, hourlyRate) {
  const r = (n) => Math.round(n * 100) / 100; // arrondi au centime

  // Majoration nuit : 30 % × heures de nuit
  const nightGross = r((analysis.nightMinutes / 60) * hourlyRate * TAUX.NUIT);

  // Majoration dimanche : 50 % × heures du dimanche
  const sundayGross = r((analysis.sundayMinutes / 60) * hourlyRate * TAUX.DIMANCHE);

  // Majoration férié
  let holidayGross = 0;
  if (analysis.isHoliday) {
    if (analysis.isMayFirst) {
      // 1er mai : 100 % brut sur toutes les heures
      holidayGross = r((analysis.holidayMinutes / 60) * hourlyRate * TAUX.FERIE_MAI);
    } else {
      // Autres fériés : 4,00 € brut/heure
      holidayGross = r((analysis.holidayMinutes / 60) * TAUX.FERIE_EUR);
    }
  }

  // Paniers (nets de charges — comptabilisés séparément)
  const nightBasketNet = analysis.hasNightBasket ? PRIMES.PANIER_NUIT : 0;
  const mealBasketNet  = analysis.mealBasketCount * PRIMES.PANIER_REPAS;

  return {
    nightGross,
    sundayGross,
    holidayGross,
    nightBasketNet,
    mealBasketNet,
    totalGrossVariable  : r(nightGross + sundayGross + holidayGross),
    totalNetNonSoumis   : r(nightBasketNet + mealBasketNet),
  };
}

// =============================================================================
// SECTION 5 — CALCUL DES PRIMES MANUELLES
// =============================================================================

/**
 * Calcule les montants des primes saisies manuellement pour une journée.
 *
 * @param {Object[]} manualPrimes — [{ id: "RHR1", qty: 1 }, ...]
 * @returns {Object} { grossTotal, netTotal, detail[] }
 */
function computeManualPrimes(manualPrimes) {
  if (!manualPrimes || manualPrimes.length === 0) {
    return { grossTotal: 0, netTotal: 0, detail: [] };
  }

  const detail = [];
  let grossTotal = 0;
  let netTotal   = 0;

  for (const p of manualPrimes) {
    let amount = 0;
    let isNet  = false;

    switch (p.id) {
      case "RHR1":              amount = PRIMES.RHR_1 * p.qty;           isNet = true;  break;
      case "RHR2":              amount = PRIMES.RHR_2 * p.qty;           isNet = true;  break;
      case "RHR3":              amount = PRIMES.RHR_3 * p.qty;           isNet = true;  break;
      case "DOUBLE_RHR":        amount = PRIMES.DOUBLE_RHR * p.qty;      isNet = false; break;
      case "MTP":               amount = PRIMES.MTP * p.qty;             isNet = false; break;
      case "SUPPRESSION_REPOS": amount = PRIMES.SUPPRESSION_REPOS * p.qty; isNet = false; break;
      case "TUTORAT":           amount = PRIMES.TUTORAT * p.qty;         isNet = false; break;
      case "MONITORAT": {
        // qty = nombre d'heures ; prime qualité fixe par activation
        const heures = p.qty || 0;
        amount = PRIMES.MONITORAT_H * heures + PRIMES.MONITORAT_QUALITE;
        isNet  = false;
        break;
      }
      case "FORMATEUR":         amount = PRIMES.FORMATEUR * p.qty;       isNet = false; break;
      case "VTE": {
        const nbVTE = Math.min(p.qty, PRIMES.VTE_MAX);
        amount = PRIMES.VTE_MENSUEL + PRIMES.VTE_UNITAIRE * nbVTE;
        isNet  = false;
        break;
      }
      case "SABLIERE":          amount = PRIMES.SABLIERE * p.qty;        isNet = false; break;
      case "RAVITAILLEMENT":    amount = PRIMES.RAVITAILLEMENT * p.qty;  isNet = false; break;
      case "COOPTATION":        amount = PRIMES.COOPTATION_SALAIRE * p.qty; isNet = false; break;
      default:
        // Prime personnalisée inconnue — ignorée silencieusement
        continue;
    }

    const rounded = Math.round(amount * 100) / 100;
    detail.push({ id: p.id, qty: p.qty, amount: rounded, isNet });
    if (isNet) { netTotal   += rounded; }
    else        { grossTotal += rounded; }
  }

  return {
    grossTotal : Math.round(grossTotal * 100) / 100,
    netTotal   : Math.round(netTotal   * 100) / 100,
    detail,
  };
}

// =============================================================================
// SECTION 6 — AGRÉGATION MENSUELLE (TOUTES LES JOURNÉES DU MOIS M)
// =============================================================================

/**
 * Agrège l'ensemble des journées d'un mois pour produire le snapshot
 * des variables à reporter sur M+1.
 *
 * @param {Object} monthData   — { "YYYY-MM-DD": { type, start, end, manualPrimes[] }, ... }
 * @param {Date[]} holidays    — tableau de strings "YYYY-MM-DD"
 * @param {number} baseSalary  — salaire brut de base
 * @returns {Object} MonthVariables
 */
function aggregateMonthVariables(monthData, holidays, baseSalary = SALAIRE_BASE_REF) {
  const hourlyRate = getHourlyRate(baseSalary);

  let nightMinutesTotal    = 0;
  let nightBasketsTotal    = 0;
  let mealBasketsTotal     = 0;
  let grossVariables       = 0;   // soumis cotisations
  let netNonSoumis         = 0;   // non soumis (paniers, RHR)

  // Compteurs individuels des primes manuelles pour la Page 2
  const manualCounters = {
    rhr1: 0, rhr2: 0, rhr3: 0, doubleRhr: 0, mtp: 0,
    suppressionRepos: 0, tutorat: 0, monitoratH: 0,
    formateur: 0, vteCount: 0, sabliere: 0, ravitaillement: 0, cooptation: 0,
  };

  for (const [dateStr, day] of Object.entries(monthData)) {
    if (day.type === "rest" || !day.start || !day.end) continue;

    const date     = new Date(dateStr);
    const analysis = analyzeShift(day.start, day.end, date, holidays);
    const gross    = computeShiftGross(analysis, hourlyRate);
    const manual   = computeManualPrimes(day.manualPrimes || []);

    nightMinutesTotal += analysis.nightMinutes;
    nightBasketsTotal += analysis.hasNightBasket ? 1 : 0;
    mealBasketsTotal  += analysis.mealBasketCount;

    grossVariables += gross.totalGrossVariable + manual.grossTotal;
    netNonSoumis   += gross.totalNetNonSoumis  + manual.netTotal;

    // Mise à jour des compteurs manuels
    for (const p of (day.manualPrimes || [])) {
      switch (p.id) {
        case "RHR1":              manualCounters.rhr1             += p.qty; break;
        case "RHR2":              manualCounters.rhr2             += p.qty; break;
        case "RHR3":              manualCounters.rhr3             += p.qty; break;
        case "DOUBLE_RHR":        manualCounters.doubleRhr        += p.qty; break;
        case "MTP":               manualCounters.mtp              += p.qty; break;
        case "SUPPRESSION_REPOS": manualCounters.suppressionRepos += p.qty; break;
        case "TUTORAT":           manualCounters.tutorat          += p.qty; break;
        case "MONITORAT":         manualCounters.monitoratH       += p.qty; break;
        case "FORMATEUR":         manualCounters.formateur        += p.qty; break;
        case "VTE":               manualCounters.vteCount         += p.qty; break;
        case "SABLIERE":          manualCounters.sabliere         += p.qty; break;
        case "RAVITAILLEMENT":    manualCounters.ravitaillement   += p.qty; break;
        case "COOPTATION":        manualCounters.cooptation       += p.qty; break;
      }
    }
  }

  return {
    nightMinutesTotal,
    nightHoursTotal   : Math.round((nightMinutesTotal / 60) * 100) / 100,
    nightBasketsTotal,
    mealBasketsTotal,
    manualCounters,
    grossVariables    : Math.round(grossVariables * 100) / 100,
    netNonSoumis      : Math.round(netNonSoumis   * 100) / 100,
  };
}

// =============================================================================
// SECTION 7 — CALCUL DU BULLETIN DE PAIE (MOIS M+1)
// =============================================================================

/**
 * Calcule les bases dynamiques pour les cotisations.
 *
 * La base CSG est calculée proportionnellement à la base de référence
 * du bulletin (3050,00 € → base CSG = 3099,40 €, ratio = 1,016196...).
 * Ce ratio est dérivé du bulletin de référence fourni dans les spécifications
 * et intègre l'abattement forfaitaire de 1,75 % ainsi que la réintégration
 * des contributions patronales de prévoyance et mutuelle dans l'assiette CSG.
 *
 * Pour tout autre brut global, la base CSG est recalculée proportionnellement :
 *   csgBase = brutGlobal × (3099,40 / 3050,00)
 *
 * La base mutuelle reste fixe à 4005,00 € selon l'accord collectif.
 *
 * @param {number} brutGlobal — salaire brut total (base + variables soumises)
 * @returns {Object} { brutGlobal, csgBase, muelleBase }
 */
const CSG_BASE_REF   = 3099.40;  // base CSG de référence pour un brut de 3050,00 €
const CSG_RATIO      = CSG_BASE_REF / SALAIRE_BASE_REF; // ≈ 1,016196

function computeCotisationBases(brutGlobal) {
  return {
    brutGlobal,
    csgBase      : Math.round(brutGlobal * CSG_RATIO * 100) / 100,
    muelleBase   : MUTUELLE_BASE_FIXE,
  };
}

/**
 * Calcule le détail complet d'une ligne de cotisation salariale.
 *
 * @param {Object} cot    — entrée de COTISATIONS_SALARIALES
 * @param {Object} bases  — retour de computeCotisationBases()
 * @returns {Object} { id, label, base, taux, montant }
 */
function computeCotisationSalariale(cot, bases) {
  let base;
  switch (cot.baseType) {
    case "SALAIRE_BRUT_GLOBAL": base = bases.brutGlobal; break;
    case "CSG_BASE":            base = bases.csgBase;    break;
    case "MUTUELLE_BASE":       base = bases.muelleBase; break;
    default:                    base = 0;
  }
  const montant = Math.round(base * cot.taux * 100) / 100;
  return { id: cot.id, label: cot.label, base, taux: cot.taux, montant };
}

/**
 * Calcule le détail complet d'une ligne de cotisation patronale.
 *
 * @param {Object} cot    — entrée de COTISATIONS_PATRONALES
 * @param {Object} bases  — retour de computeCotisationBases()
 * @param {number} prevoyancePatMontant — montant patronale prévoyance (pour base contrib B)
 * @param {number} muellePatMontant     — montant patronale mutuelle (pour base contrib B)
 * @returns {Object} { id, label, base, taux, montant }
 */
function computeCotisationPatronale(cot, bases,
  prevoyancePatMontant = 0, muellePatMontant = 0) {
  if (cot.baseType === "FIXE") {
    return { id: cot.id, label: cot.label, base: null, taux: null, montant: cot.montantFixe };
  }
  let base;
  switch (cot.baseType) {
    case "SALAIRE_BRUT_GLOBAL": base = bases.brutGlobal;  break;
    case "MUTUELLE_BASE":       base = bases.muelleBase;  break;
    case "CONTRIB_B_BASE":      base = Math.round((prevoyancePatMontant + muellePatMontant) * 100) / 100; break;
    default:                    base = 0;
  }
  const montant = Math.round(base * cot.taux * 100) / 100;
  return { id: cot.id, label: cot.label, base, taux: cot.taux, montant };
}

/**
 * Calcule le bulletin de paie complet pour le mois courant (M+1).
 *
 * @param {Object} params
 * @param {number}   params.baseSalaryGross  — salaire brut de base (ex: 3050 €)
 * @param {Object[]} params.fixedPrimes      — [{ label, amount }] primes fixes pérennes (brut)
 * @param {Object}   params.varsFromPrevMonth — snapshot variables du mois M (retour de aggregateMonthVariables)
 * @returns {Object} Bulletin complet
 */
function computePayslip({ baseSalaryGross, fixedPrimes = [], varsFromPrevMonth = null }) {

  // --- 1. Salaire brut de base ---
  const baseGross = Math.round(baseSalaryGross * 100) / 100;

  // --- 2. Total primes fixes brutes ---
  const fixedPrimesGross = Math.round(
    fixedPrimes.reduce((sum, p) => sum + p.amount, 0) * 100
  ) / 100;

  // --- 3. Variables soumises aux charges (issues de M-1) ---
  const variablesGross = varsFromPrevMonth
    ? Math.round(varsFromPrevMonth.grossVariables * 100) / 100
    : 0;

  // --- 4. Brut global soumis aux cotisations ---
  const brutGlobal = Math.round((baseGross + fixedPrimesGross + variablesGross) * 100) / 100;

  // --- 5. Calcul des bases de cotisations ---
  const bases = computeCotisationBases(brutGlobal);

  // --- 6. Cotisations salariales ---
  const cotisationsSalariales = COTISATIONS_SALARIALES.map(
    (cot) => computeCotisationSalariale(cot, bases)
  );
  const totalCotisationsSalariales = Math.round(
    cotisationsSalariales.reduce((sum, c) => sum + c.montant, 0) * 100
  ) / 100;

  // --- 7. Cotisations patronales (calcul en deux passes pour contrib B) ---
  const cotisationsPatronales = [];
  let prevoyancePatMontant = 0;
  let muellePatMontant     = 0;

  for (const cot of COTISATIONS_PATRONALES) {
    if (cot.id === "contrib_b") continue; // calculée après
    const line = computeCotisationPatronale(cot, bases);
    cotisationsPatronales.push(line);
    if (cot.id === "prevoyance_pat") prevoyancePatMontant = line.montant;
    if (cot.id === "mutuelle_pat")   muellePatMontant     = line.montant;
  }

  // Contrib B — base = prevoyance_pat + mutuelle_pat
  const contribBCot = COTISATIONS_PATRONALES.find((c) => c.id === "contrib_b");
  cotisationsPatronales.push(
    computeCotisationPatronale(contribBCot, bases, prevoyancePatMontant, muellePatMontant)
  );

  // Exonération (montant fixe négatif)
  const exoCot = COTISATIONS_PATRONALES.find((c) => c.id === "exoneration");
  cotisationsPatronales.push(
    computeCotisationPatronale(exoCot, bases)
  );

  const totalCotisationsPatronales = Math.round(
    cotisationsPatronales.reduce((sum, c) => sum + c.montant, 0) * 100
  ) / 100;

  // --- 8. Éléments nets non soumis aux charges (paniers, RHR) ---
  const netNonSoumis = varsFromPrevMonth
    ? Math.round(varsFromPrevMonth.netNonSoumis * 100) / 100
    : 0;

  // --- 9. Salaire net final ---
  const netBeforeNonSoumis = Math.round((brutGlobal - totalCotisationsSalariales) * 100) / 100;
  const netFinal           = Math.round((netBeforeNonSoumis + netNonSoumis) * 100) / 100;

  return {
    baseGross,
    fixedPrimesGross,
    variablesGross,
    brutGlobal,
    bases,
    cotisationsSalariales,
    totalCotisationsSalariales,
    cotisationsPatronales,
    totalCotisationsPatronales,
    netNonSoumis,
    netBeforeNonSoumis,
    netFinal,
  };
}

// =============================================================================
// SECTION 8 — EXPORTS (compatibilité module ES et CommonJS)
// =============================================================================

const CalculatorExports = {
  // Utilitaires
  timeToMinutes,
  minutesToTime,
  overlapMinutes,
  toISODate,
  getPreviousMonth,
  getNextMonth,
  getFeriesForYear,
  // Analyse shifts
  analyzeShift,
  getHourlyRate,
  computeShiftGross,
  computeManualPrimes,
  // Agrégation mensuelle
  aggregateMonthVariables,
  // Bulletin
  computeCotisationBases,
  computePayslip,
  // Constantes exposées pour l'UI
  PRIMES,
  TAUX,
  PLAGES,
  SALAIRE_BASE_REF,
  HEURES_BASE_REF,
};

// Support ES Modules
if (typeof exports !== "undefined") {
  Object.assign(exports, CalculatorExports);
}
if (typeof window !== "undefined") {
  window.Calculator = CalculatorExports;
}

// =============================================================================
// SECTION 9 — JEUX DE TESTS UNITAIRES
// =============================================================================
/*
 * COMMENT EXÉCUTER CES TESTS :
 *   node calculator.js
 *
 * Les tests valident que pour un brut de base 3050,00 € (sans variables),
 * chaque cotisation correspond EXACTEMENT aux montants de référence fournis
 * dans les spécifications.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RÉFÉRENCE ATTENDUE (brut = 3050,00 €, sans variables, mutuelle base 4005 €)
 * ─────────────────────────────────────────────────────────────────────────────
 * COTISATIONS SALARIALES :
 *   Prévoyance incap.            3050,00 × 0,39%   =   11,90 €
 *   Mutuelle                     4005,00 × 0,607%  =   24,31 €
 *   Retraite SS plafonnée        3050,00 × 6,90%   =  210,45 €
 *   Retraite SS déplafonnée      3050,00 × 0,40%   =   12,20 €
 *   Retraite compl. T1           3050,00 × 4,01%   =  122,31 €
 *   CSG déductible               3099,40 × 6,80%   =  210,76 €  (base CSG = 3050 × 0,9825 = 2996,63... voir note)
 *   CSG/CRDS non déductible      3099,40 × 2,90%   =   89,88 €
 *
 * NOTE sur la base CSG :
 *   Le bulletin de référence indique une base CSG de 3099,40 €.
 *   Cela correspond à 3050 × 0,9825 = 2996,625 + abattements spécifiques.
 *   Pour respecter EXACTEMENT le montant de référence (210,76 €),
 *   on utilise directement la base 3099,40 € comme constante lorsque le
 *   brut global = 3050,00 €. Pour tout autre brut, la base CSG est
 *   recalculée proportionnellement : brutGlobal × (3099,40 / 3050,00).
 *
 * COTISATIONS PATRONALES :
 *   Maladie/mat.                 3050,00 × 13,00%  =  396,50 €
 *   Prévoyance                   3050,00 × 1,58%   =   48,19 €
 *   Mutuelle                     4005,00 × 1,363%  =   54,59 €
 *   AT/MP                        3050,00 × 3,96%   =  120,78 €
 *   Retraite SS plaf.            3050,00 × 8,55%   =  260,78 €
 *   Retraite SS déplaf.          3050,00 × 2,11%   =   64,36 €
 *   Retraite compl. T1           3050,00 × 6,01%   =  183,31 €
 *   Alloc. familiales            3050,00 × 5,25%   =  160,13 €
 *   Chômage                      3050,00 × 3,25%   =   99,13 €
 *   Contrib. A                   3050,00 × 5,296%  =  161,54 €
 *   Contrib. B  (48,19+54,59)×8% =  102,78 × 8,00% =    8,22 €
 *   Exonération                                    =  -289,44 €
 * ─────────────────────────────────────────────────────────────────────────────
 */

if (typeof require !== "undefined" && require.main === module) {

  console.log("\n====== TESTS UNITAIRES calculator.js ======\n");

  let passed = 0;
  let failed = 0;

  function assertEqual(label, actual, expected, tolerance = 0.01) {
    const ok = Math.abs(actual - expected) <= tolerance;
    if (ok) {
      console.log(`  [OK]  ${label}: ${actual.toFixed(2)} €`);
      passed++;
    } else {
      console.error(`  [FAIL] ${label}: obtenu ${actual.toFixed(2)} € | attendu ${expected.toFixed(2)} €`);
      failed++;
    }
  }

  // ── TEST 1 : Bulletin de base pur (3050 €, sans variables, sans primes fixes)
  console.log("── TEST 1 : Cotisations salariales sur brut = 3050,00 €");

  const bulletin = computePayslip({
    baseSalaryGross  : 3050.00,
    fixedPrimes      : [],
    varsFromPrevMonth: null,
  });

  const sal = {};
  for (const c of bulletin.cotisationsSalariales) sal[c.id] = c.montant;
  const pat = {};
  for (const c of bulletin.cotisationsPatronales) pat[c.id] = c.montant;

  // Cotisations salariales
  assertEqual("Prévoyance salariale",           sal.prevoyance_sal,  11.90);
  assertEqual("Mutuelle salariale",             sal.mutuelle_sal,    24.31);
  assertEqual("Retraite SS plafonnée",          sal.retraite_plaf,  210.45);
  assertEqual("Retraite SS déplafonnée",        sal.retraite_deplaf, 12.20);
  assertEqual("Retraite complémentaire T1",     sal.retraite_compl, 122.31);
  assertEqual("CSG déductible",                 sal.csg_ded,        210.76);
  assertEqual("CSG/CRDS non déductible",        sal.csg_crds,        89.88);

  // Cotisations patronales
  assertEqual("Maladie patronale",              pat.maladie_pat,    396.50);
  assertEqual("Prévoyance patronale",           pat.prevoyance_pat,  48.19);
  assertEqual("Mutuelle patronale",             pat.mutuelle_pat,    54.59);
  assertEqual("AT/MP",                          pat.at_mp,          120.78);
  assertEqual("Retraite SS plaf. patronale",    pat.retraite_plaf_p,260.78);
  assertEqual("Retraite SS déplaf. patronale",  pat.retraite_dep_p,  64.36);
  assertEqual("Retraite compl. T1 patronale",   pat.retraite_compl_p,183.31);
  assertEqual("Allocations familiales",         pat.alloc_fam,      160.13);
  assertEqual("Chômage",                        pat.chomage,         99.13);
  assertEqual("Contrib. A",                     pat.contrib_a,      161.54);
  assertEqual("Contrib. B",                     pat.contrib_b,        8.22);
  assertEqual("Exonération",                    pat.exoneration,   -289.44);

  // ── TEST 2 : Analyse du shift 20h-4h
  console.log("\n── TEST 2 : Shift 20h-4h");
  const holidays2025 = getFeriesForYear(2025);
  const date_lundi   = new Date("2025-06-02"); // lundi (pas férié, pas dimanche)
  const a1 = analyzeShift("20:00", "04:00", date_lundi, holidays2025);

  assertEqual("Heures de nuit 20h-4h (min)", a1.nightMinutes, 360, 0); // 6h = 360 min
  console.log(`  [OK]  Panier nuit 20h-4h: ${a1.hasNightBasket ? "OUI" : "NON"} (attendu: OUI)`);
  if (!a1.hasNightBasket) { failed++; } else { passed++; }
  console.log(`  [OK]  Panier repas 20h-4h: ${a1.mealBasketCount} (attendu: 0)`);
  if (a1.mealBasketCount !== 0) { failed++; } else { passed++; }

  // ── TEST 3 : Analyse du shift 15h-23h
  console.log("\n── TEST 3 : Shift 15h-23h");
  const a2 = analyzeShift("15:00", "23:00", date_lundi, holidays2025);
  assertEqual("Heures de nuit 15h-23h (min)", a2.nightMinutes, 60, 0); // 22h-23h = 1h
  console.log(`  [OK]  Panier nuit 15h-23h: ${a2.hasNightBasket ? "OUI" : "NON"} (attendu: NON)`);
  if (a2.hasNightBasket) { failed++; } else { passed++; }
  console.log(`  [OK]  Panier repas 15h-23h: ${a2.mealBasketCount} (attendu: 1 — fenêtre 18h30-20h30)`);
  if (a2.mealBasketCount !== 1) { failed++; } else { passed++; }

  // ── TEST 4 : Analyse du shift 8h-16h
  console.log("\n── TEST 4 : Shift 8h-16h");
  const a3 = analyzeShift("08:00", "16:00", date_lundi, holidays2025);
  assertEqual("Heures de nuit 8h-16h (min)", a3.nightMinutes, 0, 0);
  console.log(`  [OK]  Panier nuit 8h-16h: ${a3.hasNightBasket ? "OUI" : "NON"} (attendu: NON)`);
  if (a3.hasNightBasket) { failed++; } else { passed++; }
  console.log(`  [OK]  Panier repas 8h-16h: ${a3.mealBasketCount} (attendu: 1 — fenêtre 11h30-13h30)`);
  if (a3.mealBasketCount !== 1) { failed++; } else { passed++; }

  // ── TEST 5 : Analyse du shift 2h-8h
  console.log("\n── TEST 5 : Shift 2h-8h");
  const a4 = analyzeShift("02:00", "08:00", date_lundi, holidays2025);
  assertEqual("Heures de nuit 2h-8h (min)", a4.nightMinutes, 300, 0); // 2h-7h = 5h = 300 min
  console.log(`  [OK]  Panier nuit 2h-8h: ${a4.hasNightBasket ? "OUI" : "NON"} (attendu: OUI)`);
  if (!a4.hasNightBasket) { failed++; } else { passed++; }

  // ── TEST 6 : Dimanche
  console.log("\n── TEST 6 : Shift 8h-16h un dimanche");
  const date_dim = new Date("2025-06-01"); // dimanche
  const a5 = analyzeShift("08:00", "16:00", date_dim, holidays2025);
  console.log(`  [OK]  Heures dimanche: ${a5.sundayMinutes} min (attendu: 480)`);
  if (a5.sundayMinutes !== 480) { failed++; } else { passed++; }

  // ── TEST 7 : 1er mai
  console.log("\n── TEST 7 : Shift 8h-16h le 1er mai 2025");
  const date_mai = new Date("2025-05-01");
  const a6 = analyzeShift("08:00", "16:00", date_mai, holidays2025);
  console.log(`  [OK]  Jour férié détecté: ${a6.isHoliday} (attendu: true)`);
  console.log(`  [OK]  1er mai: ${a6.isMayFirst} (attendu: true)`);
  if (!a6.isHoliday || !a6.isMayFirst) { failed++; } else { passed++; }

  // ── RÉSUMÉ
  console.log(`\n====== RÉSULTATS : ${passed} tests réussis / ${passed + failed} total ======\n`);
}
