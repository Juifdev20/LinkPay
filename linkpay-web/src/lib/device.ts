const DEVICE_ID_KEY = 'linkpay_device_id';

/**
 * A stable UUID identifying this browser/app install — generated once and
 * reused forever from localStorage. Survives closing the app and restarting
 * the phone; only disappears if the app's data is cleared or it's
 * reinstalled (correctly treated as a new device at that point). Sent on
 * login/register so the backend can recognize "this is the same device
 * reconnecting" and skip the single-active-session conflict instead of
 * requiring an admin reset for what is genuinely the same phone.
 */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}
