import { HttpException } from '@nestjs/common';
import { LOGIN_LOCK_MS, LOGIN_WINDOW_MS, LoginAttemptsService, MAX_FAILED_LOGINS } from './login-attempts.service';

describe('LoginAttemptsService', () => {
  const fail = (s: LoginAttemptsService, email: string, n: number, t = 0) => { for (let i = 0; i < n; i++) s.recordFailure(email, t); };

  it('locks an account after too many failures, whatever the email casing', () => {
    const s = new LoginAttemptsService();
    fail(s, 'Alice@x.com', MAX_FAILED_LOGINS, 1000);
    expect(() => s.assertNotLocked('alice@x.com', 2000)).toThrow(HttpException);
  });

  it('does not lock below the limit, and a success clears the count', () => {
    const s = new LoginAttemptsService();
    fail(s, 'a@x.com', MAX_FAILED_LOGINS - 1, 1000);
    expect(() => s.assertNotLocked('a@x.com', 1500)).not.toThrow();
    s.recordSuccess('a@x.com');
    fail(s, 'a@x.com', MAX_FAILED_LOGINS - 1, 2000);
    expect(() => s.assertNotLocked('a@x.com', 2500)).not.toThrow();
  });

  it('the lock expires by itself', () => {
    const s = new LoginAttemptsService();
    fail(s, 'a@x.com', MAX_FAILED_LOGINS, 1000);
    expect(() => s.assertNotLocked('a@x.com', 1000 + LOGIN_LOCK_MS + 1)).not.toThrow();
  });

  it('failures older than the window do not add up', () => {
    const s = new LoginAttemptsService();
    fail(s, 'a@x.com', MAX_FAILED_LOGINS - 1, 0);
    s.recordFailure('a@x.com', LOGIN_WINDOW_MS + 10);
    expect(() => s.assertNotLocked('a@x.com', LOGIN_WINDOW_MS + 20)).not.toThrow();
  });

  it('accounts are independent', () => {
    const s = new LoginAttemptsService();
    fail(s, 'a@x.com', MAX_FAILED_LOGINS, 1000);
    expect(() => s.assertNotLocked('b@x.com', 1500)).not.toThrow();
  });
});
