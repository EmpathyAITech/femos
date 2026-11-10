// English intake lexicon. Entries are regular-expression fragments (case-insensitive).
// ASCII entries get a leading word boundary automatically; non-Latin script entries do not
// (JavaScript's \b does not work inside Indic scripts).
export default {
  digits: {},
  numberWords: { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 },
  negation: ['no', 'not', 'never', "don'?t", "doesn'?t", "isn'?t", "hasn'?t", 'without'],
  conjunctions: ['but', 'and', 'however'],
  units: { years: ['years?', 'yrs?'], days: ['days?'], pads: ['pads?', 'cloths?', 'napkins?'] },
  age: ['age'],
  period: ['periods?', 'menses', 'menstruation', 'bleeding'],
  since: [],
  sinceBefore: ['since', 'for'],
  pregnant: ['pregnan\\w*', 'expecting'],
  fields: {
    dizziness: ['dizz\\w*', 'giddy', 'giddiness'],
    fatigue: ['tired\\w*', 'fatigue\\w*', 'weak\\w*', 'exhaust\\w*'],
    breathless: ['breath\\w*', 'short of breath'],
    fainting: ['faint\\w*', 'passed out', 'blacked out'],
    clots: ['clots?'],
    flooding: ['leak\\w*', 'stain\\w*', 'flood\\w*'],
    soakingHourly: ['every (?:1|one|hour|1-2|one or two)[^,.;]*hours?', 'every hour'],
    heavyBleeding: ['heavy (?:bleeding|periods?|flow)', 'a lot of blood', 'bleeds? a lot'],
    ifaLastMonth: ['iron (?:tablets?|pills?)', 'ifa'],
  },
};
