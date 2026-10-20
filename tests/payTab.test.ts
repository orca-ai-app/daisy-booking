// @vitest-environment jsdom
//
// TRI-0069 (Gigi): payment opened in a new blank tab that never reached Stripe
// on some phones and in-app browsers. Those now pay in the same tab; computers
// keep the new tab (Jenni, M3 feedback).
import { describe, it, expect } from 'vitest';
import { payInSameTab } from '../src/widget/DaisyBooking';

const DESKTOP_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0';
const FACEBOOK_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0]';

describe('payInSameTab', () => {
  it('computers keep the new payment tab', () => {
    expect(payInSameTab(DESKTOP_CHROME, false)).toBe(false);
  });
  it('phones pay in the same tab', () => {
    expect(payInSameTab(IPHONE_SAFARI, true)).toBe(true);
  });
  it('in-app browsers pay in the same tab', () => {
    expect(payInSameTab(INSTAGRAM, true)).toBe(true);
    expect(payInSameTab(FACEBOOK_ANDROID, true)).toBe(true);
  });
  it('a touch-only device with a desktop-style UA (iPad) pays in the same tab', () => {
    expect(payInSameTab(DESKTOP_CHROME, true)).toBe(true);
  });
});
