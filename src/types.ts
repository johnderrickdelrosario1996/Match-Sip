export type CourtId = 'court-1' | 'court-2';

export interface TimeSlot {
  id: string; // e.g., 'c1-08'
  courtId: CourtId;
  courtName: string; // 'Court 01' | 'Court 02'
  startTime: string; // '08:00'
  endTime: string; // '09:00'
  timeLabel: string; // '08:00-09:00'
  status: 'OPEN' | 'BOOKED';
  price: number; // in PHP, e.g., 150 or 200
  courtType: string; // 'Championship Blue' | 'Neon Social'
  isPrime?: boolean;
}

export interface SelectedSlot {
  slotId: string;
  courtId: CourtId;
  courtName: string;
  timeLabel: string;
  date: string; // YYYY-MM-DD
  price: number;
}

export interface CustomerDetails {
  fullName: string;
  phoneNumber: string;
  email: string;
  notes?: string;
  proofFileName?: string;
  proofPreviewUrl?: string;
}

export type PaymentVerificationStatus = 'BOOKED' | 'VERIFIED' | 'CONFIRMED' | 'PENDING';

export interface ConfirmedBooking {
  id?: string;
  bookingReference: string;
  selectedDate: string;
  slots: SelectedSlot[];
  customer: CustomerDetails;
  totalAmount: number;
  paymentMethod: 'GCash (PayMongo)' | 'GCash' | 'InstaPay QR' | string;
  bookedAt?: string;
  createdAt?: string;
  confirmedAt?: string;
  paidAt?: string;
  paymentId?: string;
  status: PaymentVerificationStatus | string;
  paymentProofUrl?: string;
  hasPaymentProof?: boolean;
  checkoutUrl?: string;
}

export interface WeeklyEvent {
  id: string;
  day: string;
  title: string;
  time: string;
  level: string;
  badgeColor: string;
  highlight?: string;
}
