import { TimeSlot, WeeklyEvent } from '../types';

export const HOURLY_RANGES = [
  { start: '08:00', end: '09:00', isPrime: false },
  { start: '09:00', end: '10:00', isPrime: false },
  { start: '10:00', end: '11:00', isPrime: false },
  { start: '11:00', end: '12:00', isPrime: false },
  { start: '12:00', end: '13:00', isPrime: false },
  { start: '13:00', end: '14:00', isPrime: false },
  { start: '14:00', end: '15:00', isPrime: false },
  { start: '15:00', end: '16:00', isPrime: false },
  { start: '16:00', end: '17:00', isPrime: false },
  { start: '17:00', end: '18:00', isPrime: true },
  { start: '18:00', end: '19:00', isPrime: true },
  { start: '19:00', end: '20:00', isPrime: true },
  { start: '20:00', end: '21:00', isPrime: true },
  { start: '21:00', end: '22:00', isPrime: true },
  { start: '22:00', end: '23:00', isPrime: true },
  { start: '23:00', end: '24:00', isPrime: true },
];

export const BASE_PRICE_OFFPEAK = 150;
export const BASE_PRICE_PRIME = 200;

// All court slots start as OPEN; slots are marked BOOKED dynamically from Cloud Firestore
const DEFAULT_BOOKED_SLOTS: Record<string, string[]> = {
  'court-1': [],
  'court-2': [],
};

export function generateSlotsForCourt(courtId: 'court-1' | 'court-2', dateStr: string): TimeSlot[] {
  const courtName = courtId === 'court-1' ? 'Court 01' : 'Court 02';
  const courtType = courtId === 'court-1' ? 'Championship Pro' : 'Neon Social';
  const bookedForCourt = DEFAULT_BOOKED_SLOTS[courtId] || [];

  return HOURLY_RANGES.map((slot) => {
    const isBooked = bookedForCourt.includes(slot.start);
    const price = slot.isPrime ? BASE_PRICE_PRIME : BASE_PRICE_OFFPEAK;

    return {
      id: `${courtId}-${slot.start.replace(':', '')}`,
      courtId,
      courtName,
      startTime: slot.start,
      endTime: slot.end,
      timeLabel: `${slot.start}-${slot.end}`,
      status: isBooked ? 'BOOKED' : 'OPEN',
      price,
      courtType,
      isPrime: slot.isPrime,
    };
  });
}

export const WEEKLY_EVENTS: WeeklyEvent[] = [
  {
    id: 'ev-1',
    day: 'FRI',
    title: 'DOUBLES SHOOTOUT',
    time: '7:00 PM – 10:00 PM',
    level: 'All Levels',
    badgeColor: 'bg-[#00C6FF]/20 text-[#00C6FF] border-[#00C6FF]/40',
  },
  {
    id: 'ev-2',
    day: 'SAT',
    title: 'SUNRISE RALLIES',
    time: '8:00 AM – 11:00 AM',
    level: 'Open Play',
    badgeColor: 'bg-[#B3A2DB]/20 text-[#B3A2DB] border-[#B3A2DB]/40',
  },
  {
    id: 'ev-3',
    day: 'TUE',
    title: 'OPEN PLAY',
    time: '5:00 PM – 8:00 PM',
    level: 'Social Dinking',
    badgeColor: 'bg-[#00C6FF]/20 text-[#00C6FF] border-[#00C6FF]/40',
  },
  {
    id: 'ev-4',
    day: 'WED',
    title: 'LADDER NIGHT',
    time: '6:30 PM – 9:30 PM',
    level: 'Competitive 3.0+',
    badgeColor: 'bg-[#B3A2DB]/20 text-[#B3A2DB] border-[#B3A2DB]/40',
  },
  {
    id: 'ev-5',
    day: 'THU',
    title: 'SIP & SMASH',
    time: '6:00 PM – 10:00 PM',
    level: 'Social Mixers & Coffee',
    badgeColor: 'bg-[#00C6FF]/20 text-[#00C6FF] border-[#00C6FF]/40',
  },
];
