// Marathi intake lexicon: Devanagari and romanised Marathi. Machine-assisted draft, pending review.
// Entries are regular-expression fragments (case-insensitive). ASCII entries get a leading \b
// automatically; Devanagari entries do not (JavaScript's \b does not work in Indic scripts), so
// short Devanagari stems are anchored with a lookbehind on "not a Devanagari letter" instead.
// Devanagari digits are already in hi.js (all lexicons are merged).
const NOT_DEVA = '(?<![\\u0900-\\u097F])';

export default {
  digits: {},
  numberWords: {
    'एक': 1, 'दोन': 2, 'तीन': 3, 'चार': 4, 'पाच': 5, 'सहा': 6, 'सात': 7, 'आठ': 8, 'नऊ': 9, 'दहा': 10,
    'अकरा': 11, 'बारा': 12, 'तेरा': 13, 'चौदा': 14, 'पंधरा': 15, 'सोळा': 16, 'सतरा': 17, 'अठरा': 18, 'एकोणीस': 19,
    don: 2, tin: 3, pach: 5, paach: 5, saha: 6, nau: 9, nav: 9, daha: 10, bara: 12, pandhra: 15, sola: 16, satra: 17, athra: 18,
  },
  negation: ['नाही', 'नाहीत', 'नसते', 'नसतो', 'नसतात', 'नव्हते', 'नव्हती', 'कधीच नाही', 'naahi', 'nahit', 'naste', 'nasto', 'navhat[ei]', 'kadhich nahi'],
  // 'पण ' keeps its trailing space so it does not split अशक्तपणा / आपण.
  conjunctions: ['पण ', 'आणि', 'परंतु', 'तरी ', 'pan', 'ani', 'parantu'],
  units: {
    years: ['वर्षे', 'वर्ष', 'वर्षां\\S*', 'varsh\\w*'],
    days: ['दिवस', 'दिवसां', 'diva?s\\w*'],
    pads: ['पॅड\\S*', 'कापड\\S*', 'pad\\w*', 'kapad\\w*'],
  },
  age: ['वय', 'vay'],
  period: ['मासिक पाळी', 'पाळी', 'रक्तस्राव', 'paa?li', 'masik'],
  since: ['पासून', 'paa?sun'],
  sinceBefore: [],
  pregnant: ['गरोदर\\S*', 'गर्भवती', 'garodar\\w*', 'garbhavati'],
  fields: {
    dizziness: ['चक्कर', 'गरगर\\S*', 'chakk?ar', 'gargar\\w*'],
    // Not a bare थक stem: Hindi थक्के means clots. दमलेली / दमून = tired (not breathless).
    fatigue: ['थकवा', 'थकल\\S*', 'थकते', 'थकायला', 'अशक्त\\S*', `${NOT_DEVA}दमल\\S*`, `${NOT_DEVA}दमून`, 'thakva', 'thakav\\w*', 'thakl\\w*', 'ashakt\\w*', 'damle\\w*'],
    // दम only together with लाग-/भर- and at a word start, so कदम, दमट, दमलेली never fire.
    breathless: [`${NOT_DEVA}दम (?:लाग|भर)\\S*`, `${NOT_DEVA}धाप\\S*`, 'श्वास (?:घ्यायला )?(?:त्रास|लाग)\\S*', 'dh?am lag\\w*', 'dhap\\w*'],
    fainting: ['बेशुद्ध\\S*', 'भोवळ\\S*', 'शुद्ध (?:हरप|गेल)\\S*', 'besh?udd?h\\w*', 'bhoval\\w*'],
    clots: [`${NOT_DEVA}गाठी`, `${NOT_DEVA}गाठ(?:ी|ा|ं)?(?![\\u0900-\\u097F])`, 'गुठळ्या', 'गुठळी', 'gath[iy]\\w*', 'gutt?hal\\w*'],
    flooding: ['डाग', 'कपड्यांवर (?:डाग|लाग|पड)\\S*', 'अंथरुणावर\\S*', 'kapdyanvar'],
    soakingHourly: ['दर [^,.;।]{0,10}?तास\\S*', 'प्रत्येक तास\\S*', 'dar [^,.;]{0,10}?tas\\w*', 'pratyek tas\\w*'],
    heavyBleeding: [
      '(?:खूप |फार )?जास्त (?:रक्त|रक्तस्राव)', 'खूप (?:रक्त|रक्तस्राव)', 'रक्तस्राव (?:खूप|जास्त|फार)', 'रक्त (?:खूप|जास्त|फार)',
      '(?:khup )?jast[ai]? rakt\\w*', 'khup rakt\\w*', 'rakt\\w* (?:khup|jast)',
    ],
    ifaLastMonth: ['लोहाच्या गोळ\\S*', 'लोह गोळ\\S*', 'आयर्न\\S*', 'आयरन(?:च्या|ची)? गोळ\\S*', 'लाल गोळ\\S*', 'फॉलिक', 'iron (?:chi |chya )?gol\\w*', 'lohachya gol\\w*', 'lal goli'],
  },
};
