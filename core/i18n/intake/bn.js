// Bengali intake lexicon: Bengali script and romanised Bengali (as typed on phones).
// Machine-assisted draft, pending native-speaker and clinical review.
// Entries are regular-expression fragments (case-insensitive). ASCII entries get a leading \b
// automatically; Bengali-script entries do not (JavaScript's \b does not work inside Indic
// scripts), so word edges are written as look-arounds on the Bengali block [ঀ-৿] where a stem
// would otherwise match inside an unrelated word. All strings are stored in NFC, because
// intake.js normalises input to NFC (য় and ড় decompose to য/ড + nukta under NFC).
const B = 'ঀ-৿'; // Bengali Unicode block, used in look-arounds
const W0 = `(?<![${B}])`; // no Bengali letter/sign before
const W1 = `(?![${B}])`; // no Bengali letter/sign after

export default {
  digits: { '০': 0, '১': 1, '২': 2, '৩': 3, '৪': 4, '৫': 5, '৬': 6, '৭': 7, '৮': 8, '৯': 9 },
  // Number words are escaped and, when non-ASCII, matched without a left word edge by intake.js.
  // Bengali number words are matched as whole words by intake.js (a classifier such as টা/টো may
  // follow), so এক (1) never matches inside অনেক / কয়েক / প্রত্যেক.
  numberWords: {
    ek: 1, ekta: 1, ekti: 1, dui: 2, du: 2, duto: 2, duti: 2, tin: 3, tinte: 3, tinti: 3,
    char: 4, charte: 4, charti: 4, pach: 5, panch: 5, pachta: 5, panchta: 5,
    choy: 6, chhoy: 6, choyta: 6, chhoyta: 6, sat: 7, satta: 7, aat: 8, aath: 8, aatta: 8,
    noy: 9, noyta: 9, dosh: 10, doshta: 10, egaro: 11, baro: 12, ponero: 15, kuri: 20,
    'এক': 1, 'দুই': 2, 'দু': 2, 'তিন': 3, 'চার': 4, 'পাঁচ': 5, 'ছয়': 6, 'সাত': 7, 'আট': 8, 'নয়': 9,
    'দশ': 10, 'এগারো': 11, 'বারো': 12, 'পনেরো': 15, 'ষোলো': 16, 'ষোল': 16, 'সতেরো': 17,
    'আঠারো': 18, 'উনিশ': 19, 'কুড়ি': 20,
  },
  // Attached counting words: ৭টা প্যাড, দুটো, তিনটে, 7ta pad.
  classifiers: ['টা', 'টি', 'টো', 'টে', 'খানা', 'খানি', 'ta', 'ti', 'to', 'te'],
  negation: [
    `${W0}না${W1}`, // separate word: "ঘোরে না"
    `(?<=[েই়])না${W1}`, // joined to a verb: "ঘোরেনা", "হয়না", "খাইনা"
    `${W0}নেই${W1}`, `${W0}নাই${W1}`, `${W0}নয়${W1}`,
    `(?<=[ইিে়])নি${W1}`, // past negative: "খাইনি", "হয়নি", "করেনি"
    'na', 'nei', 'nai', 'noy', 'ni', 'kokhono na', 'kakhono na',
    '(?:khai|hoy|kori|kore|jai|dekhi|pai)ni',
  ],
  // Non-ASCII conjunctions are matched literally, so "আর" carries spaces (not inside আরও / আরাম).
  conjunctions: ['কিন্তু', ' আর ', 'এবং', 'তবে ', 'kintu', 'ar', 'aar', 'ebong', 'tobe'],
  units: {
    years: ['বছর', 'বৎসর', 'bochh?or', 'bachh?ar', 'bosor', 'bochor'],
    days: ['দিন', 'din'],
    pads: ['প্যাড', 'কাপড়', 'ন্যাপকিন', 'kapor', 'kapod', 'nyapkin'],
  },
  age: ['বয়স', 'boy[o]?sh?', 'bayas', 'boyes'],
  period: ['মাসিক', 'পিরিয়ড', 'পিরিয়েড', 'ঋতুস্রাব', 'রক্তপাত', 'mash?ik', 'piriyod', 'roktopat'],
  since: ['ধরে', 'থেকে', 'dhore', 'theke'],
  sinceBefore: [],
  pregnant: [
    'গর্ভবতী', 'গর্ভাবস্থা', 'গর্ভে', 'পোয়াতি', 'পেটে বাচ্চা', 'অন্তঃসত্ত্বা',
    'g[ao]rbh[ao]b[ao]ti', 'poyati', 'pet ?e bacc?h?a',
  ],
  fields: {
    // "মাথা ঘুরে পড়ে যাওয়া" is fainting, not dizziness, so it is excluded here.
    dizziness: [
      'মাথা(?:টা)? ঘোর', 'মাথা(?:টা)? ঘুর(?!ে পড়)', 'মাথা(?:টা)? ঝিমঝিম',
      'matha(?:ta)? ghor', 'matha(?:ta)? ghur(?!e pore)', 'matha(?:ta)? jhim',
    ],
    fatigue: ['ক্লান্ত\\S*', 'দুর্বল\\S*', 'দূর্বল\\S*', 'klanto?\\w*', 'durbo?l\\w*', 'dubbol\\w*'],
    // "শ্বাস" must not match inside বিশ্বাস (trust); romanised needs "shwas…", not "shash…" (শাশুড়ি).
    breathless: [
      '(?<!বি)শ্বাস(?:কষ্ট| নিতে কষ্ট| ?ফেলতে কষ্ট)', 'হাঁপ', 'হাঁফ', 'দম বন্ধ', 'দম আটকে',
      'shw?ash ?kosh?to', 'swash ?kosh?to', 'shwas\\w*', 'hanp\\w*', 'haa?p dhor\\w*',
    ],
    fainting: [
      'অজ্ঞান', 'জ্ঞান হারা', 'জ্ঞান হারিয়ে', 'মাথা(?:টা)? ঘুরে পড়ে', 'বেহুঁশ',
      'ogg?y?an', 'ajnan', 'agyan', 'gyan har\\w*', 'matha(?:ta)? ghure pore', 'behu?sh',
    ],
    // "দলা" must not match inside বদলানো (changing pads).
    clots: ['চাকা', 'জমাট', `${W0}দলা`, 'chaka', 'jomat'],
    // "বিছানা" alone could mean lying in bed (fatigue), so it needs blood or a stain next to it.
    flooding: [
      'দাগ', 'কাপড়ে (?:রক্ত )?লেগে', 'বিছানায় (?:রক্ত|দাগ)', 'চাদরে (?:রক্ত|দাগ)', 'উপচে', `${W0}লিক`,
      'kapore (?:rokto )?lege', 'bichanay (?:rokto|dag)', 'upche',
    ],
    soakingHourly: [
      'প্রতি (?:এক |১ |1 |দু-?এক |এক-?দুই |এক বা দুই |[0-9০-৯][-–][0-9০-৯] )?ঘ[ণন]্টা',
      'ঘ[ণন]্টায় ঘ[ণন]্টায়', 'এক ঘ[ণন]্টার মধ্যে',
      'proti (?:ek |du |dui |1 |2 |1-2 |ek-dui )?gh[ao]nn?ta', 'gh[ao]nn?tay gh[ao]nn?tay',
    ],
    heavyBleeding: [
      '(?:অনেক|বেশি|খুব|প্রচুর|অতিরিক্ত) (?:বেশি )?(?:রক্ত|ব্লিডিং)', 'রক্ত(?:পাত)? (?:খুব )?বেশি',
      '(?:onek|beshi|khub|prochur) (?:beshi )?(?:rokto|blood|bleeding)', 'rokto(?:pat)? (?:khub )?beshi',
    ],
    ifaLastMonth: [
      'আয়রন(?:ের| এর)? (?:ট্যাবলেট|বড়ি|ওষুধ|গুলি)', 'আইরন(?:ের| এর)? (?:ট্যাবলেট|বড়ি|ওষুধ)', 'আয়রন ফলিক',
      'লাল (?:বড়ি|ট্যাবলেট)', 'আইএফএ',
      'iron(?: er)? (?:bori|oshudh|oshud)', 'ayron(?: er)? (?:tablet|bori|oshudh)', 'lal (?:bori|tablet)',
    ],
  },
};
