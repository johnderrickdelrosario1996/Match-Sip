import React from 'react';
import { useNavigate } from 'react-router-dom';
import { HeroSection } from '../components/HeroSection';
import { BookingMatrix } from '../components/BookingMatrix';
import { RapidCheckout } from '../components/RapidCheckout';
import { FindUsSection } from '../components/FindUsSection';
import { TimeSlot, SelectedSlot, ConfirmedBooking } from '../types';

interface HomePageProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  selectedSlots: SelectedSlot[];
  persistedBookings: ConfirmedBooking[];
  isLoadingBookings: boolean;
  onToggleSlot: (slot: TimeSlot, dateStr: string) => void;
  onClearSlots: () => void;
  onBookingComplete: (booking: ConfirmedBooking) => Promise<void> | void;
}

export const HomePage: React.FC<HomePageProps> = ({
  selectedDate,
  onSelectDate,
  selectedSlots,
  persistedBookings,
  isLoadingBookings,
  onToggleSlot,
  onClearSlots,
  onBookingComplete,
}) => {
  const navigate = useNavigate();

  const scrollToSection = (sectionId: string) => {
    let el = document.getElementById(sectionId);
    if (!el && sectionId === 'booking-matrix') {
      el = document.getElementById('court-matrix-section');
    }
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleQuickBookClick = () => {
    scrollToSection('court-matrix-section');
  };

  return (
    <div className="flex flex-col flex-1">
      {/* 1. Hero Section */}
      <HeroSection onQuickBookSubmit={handleQuickBookClick} />

      {/* 2. Live Court Booking Matrix ("PICK YOUR TIME & SPACE") */}
      <BookingMatrix
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        selectedSlots={selectedSlots}
        persistedBookings={persistedBookings}
        isLoadingBookings={isLoadingBookings}
        onToggleSlot={onToggleSlot}
        onClearSlots={onClearSlots}
        onProceedToCheckout={() => scrollToSection('rapid-checkout')}
        onOpenReservationsModal={() => navigate('/bookings')}
      />

      {/* 3. Rapid Checkout ("CONFIRM YOUR SERVE") with InstaPay QR */}
      <RapidCheckout
        selectedDate={selectedDate}
        selectedSlots={selectedSlots}
        onBookingComplete={onBookingComplete}
        onNavigateToMatrix={() => scrollToSection('court-matrix-section')}
      />

      {/* 4. Find Us Section ("FIND OUR COURTS") with interactive map and directions */}
      <FindUsSection />
    </div>
  );
};
