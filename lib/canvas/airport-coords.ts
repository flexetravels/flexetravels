// ─── Airport / City coordinates ──────────────────────────────────────────────
// Static lookup of major airports + cities used by the canvas map. Lets us
// render the route without an HTTP geocoding call on every change.
//
// Coordinates: [longitude, latitude] (Mapbox order).
// Coverage: top 100ish airports across NA + Europe + Asia + LATAM.
// Fallback: if not in the table, the marker is skipped (route line still drawn
// between known points).

export const AIRPORT_COORDS: Record<string, [number, number]> = {
  // North America — Canada
  YYZ: [-79.6306, 43.6777], YVR: [-123.1844, 49.1967], YUL: [-73.7408, 45.4706],
  YYC: [-114.0193, 51.1215], YOW: [-75.6692, 45.3225], YEG: [-113.5800, 53.3097],
  YHZ: [-63.5086, 44.8808], YWG: [-97.2399, 49.9100], YYJ: [-123.4258, 48.6469],

  // North America — US
  JFK: [-73.7781, 40.6413], LGA: [-73.8740, 40.7769], EWR: [-74.1745, 40.6895],
  LAX: [-118.4085, 33.9416], ORD: [-87.9073, 41.9742], ATL: [-84.4277, 33.6407],
  DFW: [-97.0380, 32.8998], DEN: [-104.6737, 39.8561], SEA: [-122.3088, 47.4502],
  SFO: [-122.3790, 37.6213], MIA: [-80.2870, 25.7959], BOS: [-71.0096, 42.3656],
  PHX: [-112.0078, 33.4342], LAS: [-115.1537, 36.0840], MCO: [-81.3081, 28.4312],
  IAH: [-95.3414, 29.9902], MSP: [-93.2218, 44.8848], DTW: [-83.3554, 42.2124],
  IAD: [-77.4565, 38.9531], PHL: [-75.2424, 39.8729], PDX: [-122.5970, 45.5898],
  HNL: [-157.9224, 21.3187], ANC: [-149.9959, 61.1741],

  // Latin America / Caribbean
  CUN: [-86.8770, 21.0382], MEX: [-99.0721, 19.4361], GRU: [-46.4731, -23.4356],
  EZE: [-58.5358, -34.8222], LIM: [-77.1143, -12.0219], BOG: [-74.1469, 4.7016],
  HAV: [-82.4091, 22.9892], PUJ: [-68.3631, 18.5673], SJU: [-66.0021, 18.4394],
  // Mexico beach/resort + Central / South America extras
  PVR: [-105.2542, 20.6802], SJD: [-109.7211, 23.1518], MZT: [-106.2660, 23.1614],
  ZIH: [-101.4606, 17.6016], ACA: [-99.7560, 16.7571], CZM: [-86.9256, 20.5224],
  OAX: [-96.7266, 17.0000], MID: [-89.6577, 20.9370],
  SJO: [-84.2090, 9.9939], LIR: [-85.5444, 10.5933], PTY: [-79.3835, 9.0714],
  GUA: [-90.5275, 14.5833], SAL: [-89.0560, 13.4409], HAVANA: [-82.4091, 22.9892],
  // Caribbean
  NAS: [-77.4660, 25.0389], MBJ: [-77.9134, 18.5037], KIN: [-76.7875, 17.9357],
  AUA: [-70.0150, 12.5014], CUR: [-68.9598, 12.1889], BGI: [-59.4924, 13.0747],
  SXM: [-63.1089, 18.0410], ANU: [-61.7926, 17.1367], STT: [-64.9734, 18.3373],
  // Brazil regional
  GIG: [-43.2436, -22.8099], SDU: [-43.1631, -22.9105], BSB: [-47.9181, -15.8697],
  SSA: [-38.3324, -12.9086], REC: [-34.9236, -8.1265], FOR: [-38.5326, -3.7763],
  // Hawaii / South Pacific
  OGG: [-156.4304, 20.8986], KOA: [-156.0456, 19.7388], LIH: [-159.3389, 21.9760],
  ITO: [-155.0455, 19.7202], PPT: [-149.6112, -17.5536], NAN: [177.4389, -17.7553],
  // US misc
  AUS: [-97.6699, 30.1944], SAN: [-117.1933, 32.7338], SLC: [-111.9778, 40.7884],
  TPA: [-82.5333, 27.9755], FLL: [-80.1527, 26.0726], RDU: [-78.7875, 35.8801],
  BNA: [-86.6781, 36.1245], BWI: [-76.6684, 39.1754], PIT: [-80.2329, 40.4915],
  CLT: [-80.9430, 35.2140], MCI: [-94.7129, 39.2976], OAK: [-122.2197, 37.7126],

  // Europe — UK / Ireland
  LHR: [-0.4543,  51.4700], LGW: [-0.1903,  51.1537], STN: [ 0.2389, 51.8849],
  LTN: [-0.3683, 51.8747], MAN: [-2.2750, 53.3537], DUB: [-6.2700, 53.4213],
  EDI: [-3.3725, 55.9500], BHX: [-1.7479, 52.4539], BFS: [-6.2158, 54.6575],
  // France
  CDG: [ 2.5479, 49.0097], ORY: [ 2.3651, 48.7233], NCE: [ 7.2151, 43.6584],
  LYS: [ 5.0888, 45.7256], MRS: [ 5.2139, 43.4393],
  // Iberia
  BCN: [ 2.0833, 41.2974], MAD: [-3.5676, 40.4983], AGP: [-4.4991, 36.6749],
  PMI: [ 2.7388, 39.5517], IBZ: [ 1.3731, 38.8729],
  LIS: [-9.1342, 38.7813], OPO: [-8.6814, 41.2480], FAO: [-7.9658, 37.0144],
  // Italy
  FCO: [12.2389, 41.8003], MXP: [ 8.7281, 45.6306], LIN: [ 9.2767, 45.4451],
  VCE: [12.3519, 45.5053], NAP: [14.2908, 40.8861], CTA: [15.0664, 37.4668],
  PMO: [13.0991, 38.1759], FLR: [11.2050, 43.8100], BLQ: [11.2876, 44.5354],
  // German-speaking
  FRA: [ 8.5707, 50.0379], MUC: [11.7861, 48.3537], BER: [13.5033, 52.3667],
  HAM: [10.0053, 53.6304], DUS: [ 6.7668, 51.2895], CGN: [ 7.1428, 50.8659],
  STR: [ 9.2218, 48.6899], ZRH: [ 8.5489, 47.4647], GVA: [ 6.1097, 46.2381],
  VIE: [16.5697, 48.1103], SZG: [12.9893, 47.7933], INN: [11.3439, 47.2602],
  GRZ: [15.4396, 46.9911],
  // Benelux + Scandinavia + Iceland
  AMS: [ 4.7639, 52.3105], BRU: [ 4.4844, 50.9014], LUX: [ 6.2113, 49.6233],
  CPH: [12.6561, 55.6180], ARN: [17.9186, 59.6519], OSL: [11.1004, 60.1939],
  HEL: [24.9633, 60.3172], BLL: [ 9.1517, 55.7404], KEF: [-22.6056, 63.9850],
  // Eastern + Southern Europe
  PRG: [14.2632, 50.1008], BUD: [19.2611, 47.4399], WAW: [20.9671, 52.1657],
  KRK: [19.7848, 50.0777], OTP: [26.0852, 44.5722], SOF: [23.4114, 42.6953],
  ATH: [23.9445, 37.9364], JTR: [25.4793, 36.3992], JMK: [25.3481, 37.4351],
  HER: [25.1803, 35.3397], RHO: [28.0866, 36.4054], SKG: [22.9709, 40.5197],
  IST: [28.8146, 41.2753], SAW: [29.3092, 40.8986], AYT: [30.7980, 36.8987],
  DBV: [18.2682, 42.5614], SPU: [16.2980, 43.5389], ZAG: [16.0688, 45.7429],
  TLL: [24.8328, 59.4133], RIX: [23.9711, 56.9236], VNO: [25.2858, 54.6341],
  BTS: [17.2127, 48.1702],

  // Middle East / Africa
  DXB: [55.3644, 25.2532], DOH: [51.6080, 25.2731], AUH: [54.6511, 24.4330],
  CAI: [31.4056, 30.1219], JNB: [28.2460, -26.1392], CPT: [18.6017, -33.9648],
  TLV: [34.8867, 32.0114],

  // Asia
  NRT: [140.3929, 35.7720], HND: [139.7798, 35.5494], ICN: [126.4407, 37.4602],
  HKG: [113.9145, 22.3080], TPE: [121.2333, 25.0797], BKK: [100.7501, 13.6900],
  SIN: [103.9915,  1.3644], KUL: [101.7099,  2.7456], CGK: [106.6559, -6.1256],
  DPS: [115.1675, -8.7481], MNL: [121.0198, 14.5086], PEK: [116.5975, 40.0801],
  PVG: [121.8083, 31.1443], CAN: [113.2988, 23.3924],
  // India
  DEL: [77.1031, 28.5562], BOM: [72.8656, 19.0896], BLR: [77.7066, 13.1986],
  MAA: [80.1693, 12.9941], HYD: [78.4294, 17.2403], CCU: [88.4467, 22.6547],
  COK: [76.4019,  9.9486], GOI: [73.8324, 15.3808], AMD: [72.6347, 23.0772],

  // Oceania
  SYD: [151.1772, -33.9399], MEL: [144.8410, -37.6690], BNE: [153.1167, -27.3842],
  AKL: [174.7919, -37.0082],
};

// Common city → IATA aliases (lower-case key) for users who type city names.
// Mirrors the lookup in the canvas/command code so the map can resolve a leg
// that has only a city, not an IATA.
const CITY_TO_IATA: Record<string, string> = {
  toronto: 'YYZ', vancouver: 'YVR', montreal: 'YUL', 'montréal': 'YUL',
  mtl: 'YUL', ymq: 'YUL',  // YMQ is Duffel's metro code for Montreal — accept it as input but resolve to YUL coord-wise
  calgary: 'YYC',
  'new york': 'JFK', nyc: 'JFK', 'los angeles': 'LAX', la: 'LAX',
  chicago: 'ORD', boston: 'BOS', seattle: 'SEA', miami: 'MIA',
  london: 'LHR', paris: 'CDG', rome: 'FCO', tokyo: 'NRT', dubai: 'DXB',
  barcelona: 'BCN', madrid: 'MAD', amsterdam: 'AMS', lisbon: 'LIS',
  bali: 'DPS', cancun: 'CUN', singapore: 'SIN', bangkok: 'BKK',
  mumbai: 'BOM', delhi: 'DEL', bangalore: 'BLR', bengaluru: 'BLR',
  chennai: 'MAA', hyderabad: 'HYD', berlin: 'BER', vienna: 'VIE',
  prague: 'PRG', frankfurt: 'FRA', sydney: 'SYD', melbourne: 'MEL',
  // Greek islands + Mediterranean
  santorini: 'JTR', mykonos: 'JMK', crete: 'HER', heraklion: 'HER',
  rhodes: 'RHO', thessaloniki: 'SKG', athens: 'ATH',
  ibiza: 'IBZ', mallorca: 'PMI', malaga: 'AGP',
  // German-speaking + Eastern Europe
  munich: 'MUC', hamburg: 'HAM', dusseldorf: 'DUS', cologne: 'CGN',
  stuttgart: 'STR', salzburg: 'SZG', innsbruck: 'INN', graz: 'GRZ',
  zurich: 'ZRH', geneva: 'GVA', dublin: 'DUB', edinburgh: 'EDI',
  brussels: 'BRU', luxembourg: 'LUX', copenhagen: 'CPH', oslo: 'OSL',
  stockholm: 'ARN', helsinki: 'HEL', reykjavik: 'KEF',
  budapest: 'BUD', warsaw: 'WAW', krakow: 'KRK', bucharest: 'OTP',
  sofia: 'SOF', istanbul: 'IST', dubrovnik: 'DBV', split: 'SPU',
  zagreb: 'ZAG', tallinn: 'TLL', riga: 'RIX', vilnius: 'VNO',
  florence: 'FLR', venice: 'VCE', milan: 'MXP', naples: 'NAP',
  palermo: 'PMO', catania: 'CTA', bratislava: 'BTS',
  // France + Iberia
  nice: 'NCE', lyon: 'LYS', marseille: 'MRS', porto: 'OPO',
  // UK regional
  manchester: 'MAN', birmingham: 'BHX', belfast: 'BFS', luton: 'LTN',
  // Mexico + Central / South America
  'puerto vallarta': 'PVR', 'cabo san lucas': 'SJD', 'cabo': 'SJD',
  'los cabos': 'SJD', mazatlan: 'MZT', cozumel: 'CZM',
  ixtapa: 'ZIH', acapulco: 'ACA', oaxaca: 'OAX', merida: 'MID',
  'mexico city': 'MEX', cdmx: 'MEX',
  'san jose': 'SJO', 'costa rica': 'SJO', liberia: 'LIR',
  panama: 'PTY', 'panama city': 'PTY',
  guatemala: 'GUA', 'san salvador': 'SAL',
  // Caribbean
  nassau: 'NAS', bahamas: 'NAS', 'montego bay': 'MBJ', kingston: 'KIN',
  jamaica: 'MBJ', aruba: 'AUA', curacao: 'CUR', barbados: 'BGI',
  'st maarten': 'SXM', antigua: 'ANU', 'st thomas': 'STT',
  havana: 'HAV', 'punta cana': 'PUJ', 'san juan': 'SJU',
  // Brazil
  rio: 'GIG', 'rio de janeiro': 'GIG', brasilia: 'BSB', salvador: 'SSA',
  recife: 'REC', fortaleza: 'FOR', 'sao paulo': 'GRU',
  'buenos aires': 'EZE', lima: 'LIM', bogota: 'BOG',
  // Hawaii / South Pacific
  maui: 'OGG', kona: 'KOA', 'big island': 'KOA', kauai: 'LIH', hilo: 'ITO',
  honolulu: 'HNL', tahiti: 'PPT', fiji: 'NAN',
  // US misc
  austin: 'AUS', 'san diego': 'SAN', 'salt lake city': 'SLC',
  tampa: 'TPA', 'fort lauderdale': 'FLL', raleigh: 'RDU',
  nashville: 'BNA', baltimore: 'BWI', pittsburgh: 'PIT',
  charlotte: 'CLT', 'kansas city': 'MCI', oakland: 'OAK',
};

export function resolveCoords(iataOrCity: string | null | undefined): [number, number] | null {
  if (!iataOrCity) return null;
  const upper = iataOrCity.trim().toUpperCase();
  if (upper.length === 3 && AIRPORT_COORDS[upper]) return AIRPORT_COORDS[upper];
  const iata = CITY_TO_IATA[iataOrCity.trim().toLowerCase()];
  if (iata && AIRPORT_COORDS[iata]) return AIRPORT_COORDS[iata];
  return null;
}

// Single source of truth for city→IATA resolution. Returns null when the
// caller's input doesn't match a known airport or alias — DO NOT silently
// truncate to the first 3 letters: that's how "Montreal" became "MON"
// (Mong Hsat, Burma) and Duffel returned bizarre 14h flights.
//
// Accepts:
//   - 3-letter IATA codes (case-insensitive) → returned upper-cased
//   - City / airport aliases registered in CITY_TO_IATA
//   - Whitespace + accents (montréal, mtl, ymq, …)
export function resolveIata(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 3-letter IATA shortcut
  if (/^[A-Za-z]{3}$/.test(trimmed)) {
    const upper = trimmed.toUpperCase();
    return AIRPORT_COORDS[upper] ? upper : null;
  }

  // Strip accents + lowercase for the alias lookup. Decompose accented
  // letters into base + combining mark, then drop the combining marks
  // (U+0300–U+036F) so "Montréal" matches "montreal".
  const key = trimmed
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  const iata = CITY_TO_IATA[key] ?? CITY_TO_IATA[trimmed.toLowerCase()];
  return iata ?? null;
}
