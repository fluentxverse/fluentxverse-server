import { expect, spyOn, test } from 'bun:test';
import { NotificationService } from '../src/services/notification.services/notification.service';

test('new booking notifications link to the booked lesson and retain schedule metadata', async () => {
  const service = new NotificationService();
  const create = spyOn(service, 'createNotification').mockImplementation(async input => input as any);
  try {
    const notification = await service.notifyNewBooking('tutor', 'Student', 'Thursday', '18:00', 'booking-id', 'student', '2026-10-08', 'slot-id');
    expect(notification.data).toMatchObject({ bookingId: 'booking-id', slotId: 'slot-id', studentId: 'student', date: '2026-10-08', time: '18:00', link: '/lesson/booking-id' });
  } finally { create.mockRestore(); }
});
