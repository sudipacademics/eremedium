import { Navigate, Route, Routes } from 'react-router-dom';
import { OpsProvider } from './store';
import { Shell } from './components/Shell';
import { Dashboard } from './components/Dashboard';
import {
  ApprovalsPage,
  AssetsPage,
  BookingsPage,
  InventoryPage,
  LogisticsPage,
  QualityPage,
  ReportsPage,
  ServicesPage,
  SettingsPage,
  UnitPage,
  UnitsPage,
} from './components/Pages';
import { PharmacyPage } from './components/Pharmacy';
import { VendorsPage } from './components/Vendors';

export default function App() {
  return (
    <OpsProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="units" element={<UnitsPage />} />
          <Route path="units/:unitId" element={<UnitPage />} />
          <Route path="bookings" element={<BookingsPage />} />
          <Route path="services" element={<ServicesPage />} />
          <Route path="logistics" element={<LogisticsPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="inventory/pharmacy" element={<PharmacyPage />} />
          <Route path="inventory/aesthetic" element={<PharmacyPage />} />
          <Route path="vendors" element={<VendorsPage />} />
          <Route path="quality" element={<QualityPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="assets" element={<AssetsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </OpsProvider>
  );
}
