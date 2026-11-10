// Tamil intake lexicon: Tamil script and romanised Tamil (Tanglish). Machine-assisted draft, pending review.
// Notes for reviewers:
// - Tamil is agglutinative. Stems are written WITHOUT the final virama (்) or with it optional ('நாள்?'),
//   because a suffix replaces the virama: நாள் + ஆக = நாளாக (ந ா ள ா க), not நாள்ஆக.
// - No \b in Tamil entries (JavaScript's \b does not work in Tamil script). ASCII entries get \b from intake.js.
// - In a regex, '?' after a Tamil letter only applies to its last code point. Use (?:க்)? for optional clusters.
// - மயக்கம் (mayakkam): the noun form மயக்கம் is mapped to FAINTING (a danger sign, so the safer reading);
//   the adverbial மயக்கமா/மயக்கமாக ("feeling faint/giddy", e.g. மயக்கமா இருக்கு) and மயக்கம் போல
//   ("like faintness") are mapped to DIZZINESS. மயங்கி (விழுந்தேன்) is always fainting.
// - Negation: இல்லை/இல்ல, -வில்லை, கிடையாது and a few colloquial past negatives (வரல, ஆகல, சாப்பிடல, சுத்தல).
//   முடியல/முடியவில்லை ("cannot", e.g. மூச்சு விட முடியல = cannot breathe) and தெரியல ("don't know")
//   are deliberately NOT negation: they would turn a positive symptom or silence into "no".
//   தெம்பே இல்லை / சக்தி இல்லை ("no strength") is fatigue = yes, so negation skips இல்ல after those words.
const NUM_TA = {
  'ஒன்று': 1, 'ஒண்ணு': 1, 'ஒரு': 1, 'இரண்டு': 2, 'ரெண்டு': 2, 'மூன்று': 3, 'மூணு': 3, 'நான்கு': 4, 'நாலு': 4,
  'ஐந்து': 5, 'அஞ்சு': 5, 'ஆறு': 6, 'ஏழு': 7, 'எட்டு': 8, 'ஒன்பது': 9, 'பத்து': 10,
  'பதினொன்று': 11, 'பன்னிரண்டு': 12, 'பதிமூன்று': 13, 'பதினான்கு': 14, 'பதினைந்து': 15, 'பதினாறு': 16,
  'பதினேழு': 17, 'பதினெட்டு': 18, 'பத்தொன்பது': 19, 'இருபது': 20,
};
const NUM_LATN = {
  onnu: 1, oru: 1, rendu: 2, irandu: 2, moonu: 3, munu: 3, moondru: 3, naalu: 4, naangu: 4, anju: 5, ainthu: 5,
  aaru: 6, ezhu: 7, ettu: 8, ombodhu: 9, onbadhu: 9, onbathu: 9, pathu: 10, padhu: 10,
  padhinanju: 15, pathinainthu: 15, irupathu: 20, irubadhu: 20,
};
const RATHAM = '(?:இ)?ரத்த';
const RATHAM_L = 'ra(?:t|th|tth)am';

export default {
  digits: { '௦': 0, '௧': 1, '௨': 2, '௩': 3, '௪': 4, '௫': 5, '௬': 6, '௭': 7, '௮': 8, '௯': 9 },
  numberWords: { ...NUM_TA, ...NUM_LATN },
  negation: [
    '(?<!தெம்பே |தெம்பு |சக்தி |சக்தியே )இல்ல', 'கிடையாது', 'கெடையாது', '(?<!முடிய|தெரிய)வில்ல',
    'வரல(?![ா்])', 'ஆகல(?![ா்])', 'சாப்பிடல(?![ா்])', 'சுத்தல(?![ா்])',
    '(?<!thembe |thembu |sakthi |sakthiye )ill(?:a|ai|ae|ey|e|ama|aama|aamal)',
    '(?:kidai|kedai|keda)ya?a?(?:dh|th|d|t)u', 'varala[iy]?', 'aagala[iy]?', 'saa?pi?dala[iy]?', 'suth?thala[iy]?',
  ],
  // Non-ASCII conjunctions are matched literally (intake.js escapes them). Longest first.
  conjunctions: ['ஆனாலும்', 'ஆனால்', 'ஆனா', 'மற்றும்', 'aanaalum', 'aanaal', 'aanaa?', 'matrum'],
  units: {
    years: ['வய[தச]', 'வருட', 'வருஷ', 'வருச', 'ஆண்டு', 'vayas\\w*', 'vayad?h?u\\w*', 'varusham\\w*', 'varudam\\w*'],
    // Not "ஒரு நாளைக்கு / நாளுக்கு" (= per day), which would otherwise read as a 1-day duration.
    days: ['நாட்கள்?', 'நாள்?(?!ைக்|ுக்)', 'தின(?:ம்|ங்கள்?)', 'naatkal\\w*', 'naal(?!u\\b|aikk|ukk)[a-z]*', 'dhinam\\w*'],
    pads: ['பேட', 'நாப்கின', 'துணி', 'thuni\\w*', 'napkin\\w*'],
  },
  age: ['வயசு', 'வயது', 'vayasu', 'vayadhu', 'vayathu'],
  period: ['மாதவிடா', 'மாதவிலக்க', 'பீரியட', 'மென்சஸ்', 'ரத்தப்போக்க', 'maa?[td]h?avi[dt]aa?[iy]\\w*', 'maa?[td]h?avilakk\\w*', 'period\\w*'],
  // Suffix forms after the day unit: நாளா / நாளாக / நாட்களாக / நாள் ஆக; romanised "naalaa", "naalaaga".
  // The romanised entry is a look-behind because the suffix is glued to the unit word (no \b inside it).
  since: ['ா(?:க|ய்)?', 'ஆக', '(?<=naal(?:a|aa|aga|aaga|ah|aaha))'],
  sinceBefore: [],
  pregnant: ['கர்ப்ப', 'கருவுற்', 'kar[bp]{1,2}(?:am|ini|ama)\\w*', 'garbam\\w*'],
  fields: {
    dizziness: [
      'தலை?\\s*(?:ச்)?\\s*சு(?:ற்ற|த்த)', 'கிறுகிறு', 'மயக்கமா(?!கி|யி)', 'மயக்கம்\\s*போல', 'மயக்க\\s*உணர்வு',
      'thal(?:ai|a)\\s*su(?:t?th?|r)\\w*', 'kirukiru\\w*', 'mayakkamaa?(?!gi|yi)\\b', 'mayakkam\\s*pola',
    ],
    fatigue: [
      'சோர்வ', 'சோர்ந்', 'களை(?:ப்ப|ச்ச|த்த)', 'அசதி', 'பலவீன', 'பலஹீன', 'தெம்ப(?:ு|ே)?\\s*இல்ல', 'தெம்பில்ல',
      'சக்தி(?:யே)?\\s*இல்ல', 'டயர்ட்',
      'sorv\\w*', 'sornth\\w*', 'kalaip\\w*', 'kalaich\\w*', 'kalachu\\w*', 'asathi', 'asadhi', 'balaveen\\w*', 'balaheen\\w*',
      'themb(?:u|e)?\\s*illa', 'sakthi(?:ye)?\\s*illa',
    ],
    breathless: ['மூச்ச', 'mooch\\w*', 'moochi\\w*', 'muchu\\w*'],
    fainting: [
      'மயங்க', 'மயக்கம்(?!\\s*போல)', 'மயக்கமா(?:கி|யி)\\s*விழு', 'நினைவு?\\s*இழ', 'நினைவிழ',
      'mayang\\w*', 'mayakkam(?!a|\\s*pola)', 'mayakkam(?:aa?)?(?:gi|yi)\\s*vizh\\w*',
    ],
    clots: [`${RATHAM}(?:க்)?\\s*கட்டி`, 'கட்டிகள', 'கட்டி(?:யா|யாக|யாய்)', 'கட்டி\\s*கட்டி', 'உறைந்த\\s*(?:இ)?ரத்த', 'katti\\w*'],
    flooding: ['கறை', 'கசி', 'ஒழுக', 'வழிந்', 'லீக்', 'karai\\w*', 'kasi\\w*', 'ozhug\\w*'],
    soakingHourly: [
      'ஒவ்வொரு\\s*(?:(?:ஒரு|1|ஒன்று|இரண்டு|ரெண்டு|1-2|1–2)\\s*)?மணி', 'மணிக்கு\\s*ஒரு', 'மணிக்கொரு', 'மணி\\s*நேரத்து(?:க்கு)?\\s*ஒரு',
      'ovvoru\\s*(?:(?:oru|1|1-2|rendu)\\s*)?mani', 'manikku\\s*oru', 'manikkoru', 'mani\\s*nerathu(?:kku)?\\s*oru',
    ],
    heavyBleeding: [
      `அதிக(?:ம்|மா(?:க)?|மான|மாய்)?\\s*${RATHAM}`, `நிறைய\\s*${RATHAM}`, `ரொம்ப\\s*${RATHAM}`,
      `${RATHAM}(?:ம்|ப்போக்கு)?\\s*(?:ரொம்ப|அதிக|நிறைய)`, '(?:அதிக|நிறைய)\\S*\\s*உதிர', 'ஹெவி',
      `(?:niraiya|romba|adhiga?m?a?)\\s*(?:${RATHAM_L}|bleeding|blood)`, `${RATHAM_L}\\s*(?:romba|niraiya|adhiga?m?)`,
      'romba\\s*heavy', 'heavy[\\s-]*aa?\\b',
    ],
    ifaLastMonth: [
      'இரும்பு(?:ச்)?\\s*(?:சத்து)?\\s*(?:-?\\s*ஃபோலிக்\\S*\\s*)?(?:அமில\\s*)?மாத்திரை', 'அயர்ன்\\s*மாத்திரை', 'சிவப்பு\\s*மாத்திரை',
      'irumbu\\w*\\s*(?:sa(?:t|th|tth)u\\s*)?(?:maa?th?irai|tablet\\w*|pill\\w*)', 'iron\\s*(?:maa?th?irai)', 'sivappu\\s*maa?th?irai',
    ],
  },
};
