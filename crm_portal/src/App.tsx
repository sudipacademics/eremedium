import { Navigate, Route, Routes } from 'react-router-dom';
import { CrmProvider } from './store';
import { Shell } from './components/Shell';
import { Dashboard } from './components/Dashboard';
import {
  AccountsPage,
  ActivitiesPage,
  BookingsPage,
  CampaignsPage,
  ContactsPage,
  DealsPage,
  FranchisePage,
  LeadsPage,
  PartnerBookingsPage,
  ReportsPage,
  SettingsPage,
} from './components/Pages';
import { WhatsAppCentrePage } from './components/WhatsAppCentre';

export default function App() {
  return (
    <CrmProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="leads" element={<Navigate to="/leads/service/aesthetic" replace />} />
          <Route path="leads/:domain/:wing" element={<LeadsPage />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="deals" element={<DealsPage />} />
          <Route path="activities" element={<Navigate to="/activities/service/aesthetic" replace />} />
          <Route path="activities/:domain/:wing" element={<ActivitiesPage />} />
          <Route path="whatsapp" element={<Navigate to="/whatsapp/all/all" replace />} />
          <Route path="whatsapp/broadcast" element={<Navigate to="/whatsapp/all/all" replace />} />
          <Route path="whatsapp/:channel/:wing" element={<WhatsAppCentrePage />} />
          <Route path="whatsapp/:wing" element={<WhatsAppCentrePage />} />
          <Route path="bookings" element={<BookingsPage />} />
          <Route path="franchise" element={<FranchisePage />} />
          <Route path="partner-bookings" element={<PartnerBookingsPage />} />
          <Route path="campaigns" element={<CampaignsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="profile" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </CrmProvider>
  );
}
