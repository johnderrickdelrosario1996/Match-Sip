import React, { useState, useMemo } from 'react';
import { 
  Search, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  Phone, 
  User, 
  ShieldCheck, 
  Database,
  ExternalLink,
  X,
  FileText
} from 'lucide-react';
import { ConfirmedBooking } from '../types';
import { formatConfirmedTimestamp } from '../utils/dateUtils';
import { useDebounce } from '../utils/useDebounce';

interface SavedBookingsSectionProps {
  bookings: ConfirmedBooking[];
  isLoading: boolean;
  onScrollToMatrix: () => void;
}

export const SavedBookingsSection: React.FC<SavedBookingsSectionProps> = ({
  bookings,
  isLoading,
  onScrollToMatrix,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 250);
  const [selectedProof, setSelectedProof] = useState<string | null>(null);

  const filteredBookings = useMemo(() => {
    const q = debouncedSearchTerm.toLowerCase().trim();
    if (!q) return bookings;
    return bookings.filter((b) => 
      b.bookingReference.toLowerCase().includes(q) ||
      b.customer.fullName.toLowerCase().includes(q) ||
      b.customer.phoneNumber.toLowerCase().includes(q) ||
      b.selectedDate.includes(q) ||
      (b.customer?.notes || '').toLowerCase().includes(q)
    );
  }, [bookings, debouncedSearchTerm]);

  return (
    <section id="saved-bookings-section" className="w-full bg-[#FFFFFF] text-[#5E2CB2] py-14 sm:py-20 border-t-2 border-[#B3A2DB]/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-8 border-b-2 border-[#B3A2DB]/30">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-[#5E2CB2]">
              <Database className="h-4 w-4 text-[#00C6FF]" />
              <span>SAVED RESERVATIONS</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#5E2CB2]/10 px-2.5 py-0.5 text-[10px] font-black text-[#5E2CB2]">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live Firestore
              </span>
            </div>
            <h2 className="font-heading text-3xl sm:text-4xl font-black uppercase text-[#5E2CB2] tracking-tight mt-1">
              Confirmed Court Bookings
            </h2>
            <p className="text-xs sm:text-sm text-[#5E2CB2]/80 mt-1 max-w-xl">
              All reservations saved to your persistent database. Filter by reference number, player name, date, or contact phone.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="rounded-full bg-[#5E2CB2] px-3.5 py-1.5 text-xs font-black uppercase tracking-wider text-[#FFFFFF]">
              {bookings.length} {bookings.length === 1 ? 'Booking' : 'Bookings'}
            </span>
          </div>
        </div>

        {/* Search Bar */}
        <div className="py-6">
          <div className="relative max-w-lg">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#5E2CB2]/60" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by Player, Phone, Date (YYYY-MM-DD), or Ref #..."
              className="w-full rounded-xl border-2 border-[#B3A2DB]/60 bg-white pl-10 pr-4 py-2.5 text-xs sm:text-sm font-semibold text-[#5E2CB2] placeholder-[#5E2CB2]/50 focus:border-[#5E2CB2] focus:outline-none shadow-sm"
            />
          </div>
        </div>

        {/* Bookings Display Area */}
        {isLoading ? (
          <div className="py-16 text-center text-xs text-[#5E2CB2] flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-3 border-[#5E2CB2] border-t-transparent" />
            <span className="font-bold">Syncing reservations from Cloud Firestore...</span>
          </div>
        ) : filteredBookings.length === 0 ? (
          <div className="rounded-2xl sm:rounded-3xl border-2 border-dashed border-[#B3A2DB]/60 p-10 sm:p-14 text-center bg-[#5E2CB2]/5">
            <Calendar className="h-10 w-10 mx-auto mb-3 text-[#5E2CB2]/40" />
            <h3 className="font-heading text-lg font-black text-[#5E2CB2]">
              {searchTerm ? 'No matching bookings found' : 'No reservations recorded yet'}
            </h3>
            <p className="text-xs sm:text-sm text-[#5E2CB2]/70 mt-1 max-w-md mx-auto">
              {searchTerm
                ? 'Try searching with a different player name, date, or booking reference.'
                : 'Select available slots on Court 01 or Court 02 above to make your first court reservation.'}
            </p>
            <button
              type="button"
              onClick={onScrollToMatrix}
              className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-[#5E2CB2] px-6 py-2.5 text-xs font-black uppercase tracking-wider text-[#FFFFFF] shadow-md hover:bg-[#5E2CB2]/90 transition-all active:scale-95 cursor-pointer"
            >
              Pick A Court Slot
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredBookings.map((b) => (
              <div
                key={b.id || b.bookingReference}
                className="rounded-2xl border-2 border-[#B3A2DB]/40 bg-white p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
              >
                <div>
                  {/* Card Top: Reference + Status */}
                  <div className="flex items-center justify-between pb-3 border-b border-[#B3A2DB]/20">
                    <span className="font-mono text-xs font-black text-[#5E2CB2]">
                      #{b.bookingReference}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 text-[10px] font-black text-emerald-800 uppercase">
                      <CheckCircle2 className="h-3 w-3" />
                      {b.status || 'Verified'}
                    </span>
                  </div>

                  {/* Customer Info */}
                  <div className="pt-3 pb-2 space-y-1">
                    <div className="flex items-center gap-2 text-sm font-black text-[#5E2CB2]">
                      <User className="h-3.5 w-3.5 text-[#5E2CB2]/70 shrink-0" />
                      <span className="truncate">{b.customer.fullName}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-medium text-[#5E2CB2]/80">
                      <Phone className="h-3 w-3 text-[#5E2CB2]/70 shrink-0" />
                      <span>{b.customer.phoneNumber}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-[#5E2CB2]/75 pt-0.5">
                      <Clock className="h-3 w-3 text-[#00C6FF] shrink-0" />
                      <span>Confirmed:</span>
                      <span className="font-mono text-[#5E2CB2] font-bold">
                        {formatConfirmedTimestamp(b.confirmedAt || b.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Reserved Slots */}
                  <div className="mt-2 pt-2 border-t border-[#B3A2DB]/20">
                    <div className="flex items-center justify-between text-xs text-[#5E2CB2]/70 font-semibold mb-1.5">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {b.selectedDate}
                      </span>
                      <span>{b.slots.length} {b.slots.length === 1 ? 'Slot' : 'Slots'}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {b.slots.map((s, idx) => (
                        <span
                          key={`${s.slotId}-${idx}`}
                          className="rounded-md bg-[#5E2CB2]/10 px-2 py-0.5 text-[11px] font-bold text-[#5E2CB2]"
                        >
                          {s.courtName}: {s.timeLabel.replace(/\s*-\s*/, '-')}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Note / Special Requests */}
                  {b.customer?.notes && b.customer.notes.trim() ? (
                    <div className="mt-2.5 pt-2 border-t border-[#B3A2DB]/20">
                      <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 p-2 text-xs">
                        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-800 mb-0.5">
                          <FileText className="h-3 w-3 text-amber-600 shrink-0" />
                          <span>Notes / Special Requests:</span>
                        </div>
                        <p className="text-[11px] text-[#5E2CB2] font-semibold leading-relaxed break-words whitespace-pre-wrap pl-4">
                          {b.customer.notes.trim()}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Card Bottom: Total & Proof */}
                <div className="mt-4 pt-3 border-t border-[#B3A2DB]/20 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#5E2CB2]/60 block">
                      Total Paid
                    </span>
                    <span className="font-heading text-lg font-black text-[#5E2CB2]">
                      ₱{b.totalAmount}
                    </span>
                  </div>

                  {b.paymentProofUrl ? (
                    <button
                      type="button"
                      onClick={() => setSelectedProof(b.paymentProofUrl || null)}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#5E2CB2]/30 px-2.5 py-1 text-xs font-bold text-[#5E2CB2] hover:bg-[#5E2CB2]/10 transition-colors cursor-pointer"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>Receipt</span>
                    </button>
                  ) : (
                    <span className="text-[10px] font-medium text-[#5E2CB2]/50 italic">
                      InstaPay Direct
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

      {/* Proof Preview Modal */}
      {selectedProof && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="relative max-w-md w-full rounded-2xl bg-[#5E2CB2] p-4 text-white shadow-2xl border border-white/20">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/20">
              <span className="text-xs font-bold uppercase text-[#00C6FF]">Payment Proof Screenshot</span>
              <button
                onClick={() => setSelectedProof(null)}
                className="rounded-full p-1 text-white/70 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-hidden rounded-xl bg-black/50 p-1 flex items-center justify-center max-h-[70vh]">
              <img
                src={selectedProof}
                alt="InstaPay Payment Proof"
                className="max-h-[65vh] w-auto object-contain rounded-lg"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
