// Hindi intake lexicon: Devanagari and romanised (Hinglish). Machine-assisted draft, pending review.
export default {
  digits: { '०': 0, '१': 1, '२': 2, '३': 3, '४': 4, '५': 5, '६': 6, '७': 7, '८': 8, '९': 9 },
  numberWords: {
    ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, saat: 7, aath: 8, nau: 9, das: 10,
    'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पाँच': 5, 'पांच': 5, 'छह': 6, 'छः': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10,
  },
  negation: ['nahi?n?', 'nahin', 'na', 'नहीं', 'नही', 'ना', 'कभी नहीं', 'kabhi nahi'],
  conjunctions: ['lekin', 'par', 'aur', 'लेकिन', 'पर ', 'और'],
  units: { years: ['saal', 'sal', 'वर्ष', 'साल'], days: ['din', 'दिन'], pads: ['pad', 'kapde', 'kapda', 'पैड', 'कपड़े', 'कपड़ा'] },
  age: ['umar', 'umr', 'उम्र'],
  period: ['mahwari', 'mahawari', 'maahvari', 'माहवारी', 'मासिक', 'khoon', 'खून'],
  since: ['se', 'से'],
  sinceBefore: [],
  pregnant: ['garbh\\w*', 'गर्भ\\S*', 'pet se'],
  fields: {
    dizziness: ['chakk?ar', 'चक्कर'],
    fatigue: ['thaka+n\\w*', 'thakaa?vat', 'thak (?:jaati|jati|gayi)', 'kamzor\\w*', 'थकान', 'थकावट', 'थक जाती', 'कमज़ोर\\S*', 'कमजोर\\S*'],
    breathless: ['saa?ns', '(?<![\\p{L}\\p{M}])सा[ँं]?स(?![ूु])'], // not सासू (mother-in-law)
    fainting: ['behosh\\w*', 'बेहोश\\S*'],
    clots: ['thakke', 'thakka', 'थक्के', 'थक्का'], // not Bengali 'thake' (stays/lasts)
    flooding: ['daa?g\\b', 'दाग'], // not Marathi 'dagad' (stone)
    soakingHourly: ['har (?:ek )?ghante', 'हर (?:एक )?घंटे'],
    heavyBleeding: ['bahut (?:zyada |jyada )?(?:khoon|blood)', '(?:zyada|jyada) (?:khoon|bleeding)', 'ज़्यादा खून', 'ज्यादा खून', 'बहुत खून', 'अधिक रक्तस्राव'],
    ifaLastMonth: ['आयरन (?:की )?गोली', 'लाल गोली', 'laal goli', 'iron (?:ki )?goli'],
  },
};
