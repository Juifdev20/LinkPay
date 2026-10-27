/**
 * Archives of the station: one binder (classeur à levier) per year, holding the day, week, month and year reports.
 * Pure helpers on "YYYY-MM-DD" day keys (the business day, decided by the server) — never on the phone's clock.
 */

/** The binders of the picture: yellow, black, purple, green, red. A year keeps its colour. */
export const BINDER_COLORS = [
  { name: 'jaune', hex: '#f2c200', dark: '#b88f00', ink: '#1f1f24', rgb: [242, 194, 0] as [number, number, number] },
  { name: 'noir', hex: '#1f1f24', dark: '#0d0d10', ink: '#ffffff', rgb: [31, 31, 36] as [number, number, number] },
  { name: 'violet', hex: '#4a2c8f', dark: '#341d69', ink: '#ffffff', rgb: [74, 44, 143] as [number, number, number] },
  { name: 'vert', hex: '#1f7a3a', dark: '#155528', ink: '#ffffff', rgb: [31, 122, 58] as [number, number, number] },
  { name: 'rouge', hex: '#d6282e', dark: '#9c1a1f', ink: '#ffffff', rgb: [214, 40, 46] as [number, number, number] },
];
export const binderColor = (year: number) => BINDER_COLORS[((year % 5) + 5) % 5];

export const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const MONTHS_SHORT = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];

const pad = (n: number) => String(n).padStart(2, '0');
const utc = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const toKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

export const addDaysKey = (key: string, days: number) => toKey(utc(key) + days * 86_400_000);
export const monthKey = (year: number, month0: number) => `${year}-${pad(month0 + 1)}`;
export const daysInMonth = (year: number, month0: number) => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
/** Monday of the week (Mon–Sun) holding the day. */
export const mondayOf = (key: string) => {
  const dow = (new Date(utc(key)).getUTCDay() + 6) % 7;
  return addDaysKey(key, -dow);
};

/** The weeks (Mon–Sun) that touch a month, each with the days of the month that fall inside it. */
export function weeksOfMonth(year: number, month0: number): { monday: string; sunday: string; days: string[] }[] {
  const n = daysInMonth(year, month0);
  const weeks = new Map<string, string[]>();
  for (let d = 1; d <= n; d++) {
    const key = `${monthKey(year, month0)}-${pad(d)}`;
    const monday = mondayOf(key);
    weeks.set(monday, [...(weeks.get(monday) || []), key]);
  }
  return [...weeks.entries()].map(([monday, days]) => ({ monday, sunday: addDaysKey(monday, 6), days }));
}

export const frDate = (key: string) => key.split('-').reverse().join('/');
export const dayShort = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
export const dayLong = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const monthName = (year: number, month0: number) => `${MONTHS_FR[month0]} ${year}`;
