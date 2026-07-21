export function getPatientBottomNavItems(isAuthenticated: boolean) {
  const ordersTo = isAuthenticated ? '/bookings' : '/login';
  const accountTo = isAuthenticated ? '/account' : '/login';
  return [
    { to: '/', label: 'Home', end: true, icon: '🏠' },
    { to: '/services', label: 'Services', icon: '🩺' },
    { to: '/pharmacy', label: 'Medicines', icon: '💊' },
    { to: ordersTo, label: 'Orders', icon: '📋' },
    { to: accountTo, label: 'Account', icon: '👤' },
  ];
}
