/**
 * Roles allowed unlimited concurrent devices/sessions at once. The
 * single-active-session enforcement (profiles.active_session_id, checked on
 * every request) exists so a regular account's stolen/lost device can't be
 * used alongside the real owner without an admin resetting it — but an
 * admin/super_admin legitimately needs to be logged in from more than one
 * device at a time (e.g. desk + phone), and there's no one above them to
 * contact for a reset if they got locked out by their own second device.
 */
export const SESSION_TRACKING_EXEMPT_ROLES = ['admin', 'super_admin'];
