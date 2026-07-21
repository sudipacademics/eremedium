export function getB2bBottomNavItems() {
  return [
    { to: '/b2b', label: 'Hub', end: true, icon: '🏥' },
    { to: '/b2b/catalog', label: 'Catalog', icon: '📋' },
    { to: '/b2b/order', label: 'Order', icon: '➕' },
    { to: '/b2b/wallet', label: 'Wallet', icon: '💳' },
    { to: '/b2b/statements', label: 'Statements', icon: '📊' },
  ];
}

export function getSalesBottomNavItems() {
  return [
    { to: '/sales', label: 'Portal', end: true, icon: '📍' },
    { to: '/sales/leads', label: 'Leads', icon: '🎯' },
    { to: '/sales/visit', label: 'Visit', icon: '🚶' },
    { to: '/sales/catalog', label: 'Pitch', icon: '📖' },
    { to: '/sales/commissions', label: 'Pay', icon: '💰' },
  ];
}

export function getPhleboBottomNavItems() {
  return [
    { to: '/dashboard/phlebotomist', label: 'Today', end: true, icon: '🧪' },
    { to: '/dashboard/phlebotomist/reports', label: 'Reports', icon: '📄' },
    { to: '/dashboard/hr', label: 'HR', icon: '🧾' },
    { to: '/account', label: 'Account', icon: '👤' },
  ];
}

export function getLabTechBottomNavItems() {
  return [
    { to: '/dashboard/lab-tech', label: 'Bench', end: true, icon: '🔬' },
    { to: '/bookings', label: 'Bookings', icon: '📋' },
    { to: '/dashboard/reagents', label: 'Reagents', icon: '🧪' },
    { to: '/account', label: 'Account', icon: '👤' },
  ];
}
