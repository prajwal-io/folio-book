import type {ReadingGoalsConfig} from '../types/library';
import {getLocalDateKey} from './storage';

export function getNotificationPermissionState(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestReminderPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function shouldTriggerReminderNow(goals: ReadingGoalsConfig, now: Date = new Date()): boolean {
  if (!goals.reminderEnabled) return false;
  const today = getLocalDateKey(now);
  if (goals.lastReminderDate === today) return false;

  const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
  if (goals.reminderFrequency === 'weekdays' && (dayOfWeek === 0 || dayOfWeek === 6)) {
    return false;
  }
  if (goals.reminderFrequency === 'weekends' && dayOfWeek !== 0 && dayOfWeek !== 6) {
    return false;
  }

  const [hh, mm] = goals.reminderTime.split(':').map((n) => Number(n));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return false;

  const currentMins = now.getHours() * 60 + now.getMinutes();
  const targetMins = hh * 60 + mm;
  return currentMins >= targetMins;
}

export async function showLocalReadingReminder(title: string, body: string): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.showNotification) {
        await reg.showNotification(title, {
          body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: 'folio-daily-reading-reminder',
        });
        return true;
      }
    }
    new Notification(title, {
      body,
      icon: '/icons/icon-192.png',
      tag: 'folio-daily-reading-reminder',
    });
    return true;
  } catch {
    return false;
  }
}

export function buildReminderIcsContent(goals: ReadingGoalsConfig): string {
  const [hhRaw, mmRaw] = goals.reminderTime.split(':');
  const hh = (hhRaw || '20').padStart(2, '0');
  const mm = (mmRaw || '30').padStart(2, '0');

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');

  const dtStart = `${y}${m}${d}T${hh}${mm}00`;
  const rrule =
    goals.reminderFrequency === 'weekdays'
      ? 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
      : goals.reminderFrequency === 'weekends'
        ? 'FREQ=WEEKLY;BYDAY=SA,SU'
        : 'FREQ=DAILY';

  const summary =
    goals.goalType === 'time'
      ? `Folio Reading Time (${goals.dailyMinutesTarget} min goal)`
      : `Folio Reading Session`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Folio Digital Library//Reading Reminder//EN',
    'BEGIN:VEVENT',
    `UID:folio-reading-reminder-${Date.now()}@folio.local`,
    `DTSTAMP:${y}${m}${d}T000000Z`,
    `DTSTART:${dtStart}`,
    'DURATION:PT20M',
    `RRULE:${rrule}`,
    `SUMMARY:${summary}`,
    'DESCRIPTION:Open Folio to continue reading or listening to your book.',
    'BEGIN:VALARM',
    'TRIGGER:PT0M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${summary}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
