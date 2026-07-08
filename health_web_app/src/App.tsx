import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthProvider } from './auth/AuthContext';

import { ROLES } from './auth/roles';

import { CartProvider } from './cart/CartContext';

import { PatientPortalGate } from './components/PatientPortalGate';

import { ProtectedRoute } from './components/ProtectedRoute';

import { PatientOnlyRoute } from './components/PatientOnlyRoute';

import { PublicLayout } from './components/PublicLayout';

import { StaffLayout } from './components/StaffLayout';

import { B2bLayout } from './components/B2bLayout';
import { B2bPortalPage } from './pages/b2b/B2bPortalPage';
import { B2bCatalogPage } from './pages/b2b/B2bCatalogPage';
import { B2bOrderPage } from './pages/b2b/B2bOrderPage';
import { B2bStatementsPage } from './pages/b2b/B2bStatementsPage';
import { B2bWalletPage } from './pages/b2b/B2bWalletPage';

import { SalesLayout } from './components/SalesLayout';
import { SalesPortalPage } from './pages/sales/SalesPortalPage';
import { SalesLeadsPage } from './pages/sales/SalesLeadsPage';
import { SalesVisitPage } from './pages/sales/SalesVisitPage';
import { SalesOnboardPage } from './pages/sales/SalesOnboardPage';
import { SalesFranchiseesPage } from './pages/sales/SalesFranchiseesPage';
import { SalesCatalogPage } from './pages/sales/SalesCatalogPage';
import { SalesCommissionPage } from './pages/sales/SalesCommissionPage';
import { SalesReportsPage } from './pages/sales/SalesReportsPage';
import { SalesTeamMapPage } from './pages/sales/SalesTeamMapPage';

import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { CircleLandingPage } from './pages/CircleLandingPage';

import { AccountPage } from './pages/AccountPage';

import { AppointmentBookPage } from './pages/AppointmentBookPage';

import { BookingDetailPage } from './pages/BookingDetailPage';

import { BookingsPage } from './pages/BookingsPage';

import { BookLabPage } from './pages/BookLabPage';

import { BookPanelPage } from './pages/BookPanelPage';

import { DashboardIndex } from './pages/dashboard/DashboardIndex';

import { FranchiseeDashboard } from './pages/dashboard/FranchiseeDashboard';

import { PhlebotomistDashboard } from './pages/dashboard/PhlebotomistDashboard';

import { PhlebotomistReports } from './pages/dashboard/PhlebotomistReports';

import { HrSelfServicePage } from './pages/dashboard/HrSelfServicePage';
import { ReagentDashboardPage } from './pages/dashboard/ReagentDashboardPage';

import { PublicDashboard } from './pages/dashboard/PublicDashboard';

import { StaffDashboard } from './pages/dashboard/StaffDashboard';

import { HomePage } from './pages/HomePage';

import { JourneyPage } from './pages/JourneyPage';

import { LabPage } from './pages/LabPage';
import { LabTestDetailPage } from './pages/LabTestDetailPage';

import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { SignupPage } from './pages/SignupPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { OAuthCallbackPage } from './pages/OAuthCallbackPage';

import { PharmacyCartPage } from './pages/PharmacyCartPage';

import { PharmacyCheckoutPage } from './pages/PharmacyCheckoutPage';

import { PharmacyPage } from './pages/PharmacyPage';

import { ServicesPage } from './pages/ServicesPage';



const STAFF_ACCESS = [

  ROLES.ADMIN,

  ROLES.SYSTEM_MANAGER,

  ROLES.LAB_TECH,

  ROLES.PATHOLOGIST,

];

const HR_ACCESS = [

  ROLES.PHLEBOTOMIST,

  ROLES.FRANCHISEE,

  ROLES.LAB_TECH,

  ROLES.ADMIN,

  ROLES.SYSTEM_MANAGER,

  ROLES.PATHOLOGIST,

  ROLES.SALES_REP,

  ROLES.SALES_MANAGER,

];

const SALES_ACCESS = [ROLES.SALES_REP, ROLES.SALES_MANAGER];



export default function App() {

  return (

    <BrowserRouter>

      <AuthProvider>

        <CartProvider>

          <Routes>

            <Route element={<PublicLayout />}>

              <Route element={<PatientPortalGate />}>

                <Route index element={<HomePage />} />

                <Route path="services" element={<ServicesPage />} />

                <Route path="appointments/book" element={<ProtectedRoute><AppointmentBookPage /></ProtectedRoute>} />

                <Route path="diagnostics" element={<LabPage />} />

                <Route path="diagnostics/test/:itemCode" element={<LabTestDetailPage />} />

                <Route path="lab" element={<Navigate to="/diagnostics" replace />} />

                <Route path="pharmacy" element={<PharmacyPage />} />

                <Route path="pharmacy/cart" element={<PharmacyCartPage />} />

                <Route

                  path="diagnostics/book/:itemCode"

                  element={

                    <ProtectedRoute>

                      <BookLabPage />

                    </ProtectedRoute>

                  }

                />

                <Route

                  path="diagnostics/panel/:panelId"

                  element={

                    <ProtectedRoute>

                      <BookPanelPage />

                    </ProtectedRoute>

                  }

                />

                <Route

                  path="lab/book/:itemCode"

                  element={

                    <ProtectedRoute>

                      <BookLabPage />

                    </ProtectedRoute>

                  }

                />

                <Route

                  path="pharmacy/checkout"

                  element={

                    <ProtectedRoute>

                      <PharmacyCheckoutPage />

                    </ProtectedRoute>

                  }

                />

                <Route

                  path="journey"

                  element={

                    <ProtectedRoute>

                      <JourneyPage />

                    </ProtectedRoute>

                  }

                />

                <Route

                  path="bookings"

                  element={

                    <ProtectedRoute>

                      <BookingsPage />

                    </ProtectedRoute>

                  }

                />

                <Route

                  path="bookings/:trfId"

                  element={

                    <ProtectedRoute>

                      <BookingDetailPage />

                    </ProtectedRoute>

                  }

                />

                <Route

                  path="account"

                  element={

                    <ProtectedRoute>

                      <AccountPage />

                    </ProtectedRoute>

                  }

                />

                <Route path="subscriptions" element={<SubscriptionsPage />} />
                <Route path="circle" element={<CircleLandingPage />} />

              </Route>

              <Route path="b2b" element={<B2bLayout />}>
                <Route index element={<B2bPortalPage />} />
                <Route path="catalog" element={<B2bCatalogPage />} />
                <Route path="order" element={<B2bOrderPage />} />
                <Route path="wallet" element={<B2bWalletPage />} />
                <Route path="statements" element={<B2bStatementsPage />} />
              </Route>

              <Route
                path="sales"
                element={
                  <ProtectedRoute roles={SALES_ACCESS}>
                    <SalesLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<SalesPortalPage />} />
                <Route path="leads" element={<SalesLeadsPage />} />
                <Route path="visit" element={<SalesVisitPage />} />
                <Route path="onboard" element={<SalesOnboardPage />} />
                <Route path="franchisees" element={<SalesFranchiseesPage />} />
                <Route path="catalog" element={<SalesCatalogPage />} />
                <Route path="commissions" element={<SalesCommissionPage />} />
                <Route path="reports" element={<SalesReportsPage />} />
                <Route path="map" element={<SalesTeamMapPage />} />
              </Route>

              <Route path="login" element={<LoginPage />} />
              <Route path="signup" element={<SignupPage />} />
              <Route path="forgot-password" element={<ForgotPasswordPage />} />
              <Route path="verify-email" element={<VerifyEmailPage />} />
              <Route path="oauth/callback" element={<OAuthCallbackPage />} />

            </Route>



            <Route

              path="dashboard"

              element={

                <ProtectedRoute>

                  <StaffLayout />

                </ProtectedRoute>

              }

            >

              <Route index element={<DashboardIndex />} />

              <Route

                path="patient"

                element={

                  <PatientOnlyRoute>

                    <PublicDashboard />

                  </PatientOnlyRoute>

                }

              />

              <Route

                path="franchisee"

                element={

                  <ProtectedRoute roles={[ROLES.FRANCHISEE]}>

                    <FranchiseeDashboard />

                  </ProtectedRoute>

                }

              />

              <Route

                path="phlebotomist"

                element={

                  <ProtectedRoute roles={[ROLES.PHLEBOTOMIST]}>

                    <PhlebotomistDashboard />

                  </ProtectedRoute>

                }

              />

              <Route

                path="phlebotomist/reports"

                element={

                  <ProtectedRoute roles={[ROLES.PHLEBOTOMIST]}>

                    <PhlebotomistReports />

                  </ProtectedRoute>

                }

              />

              <Route

                path="hr"

                element={

                  <ProtectedRoute roles={HR_ACCESS}>

                    <HrSelfServicePage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="staff"

                element={

                  <ProtectedRoute roles={STAFF_ACCESS}>

                    <StaffDashboard />

                  </ProtectedRoute>

                }

              />

              <Route

                path="reagents"

                element={

                  <ProtectedRoute roles={STAFF_ACCESS}>

                    <ReagentDashboardPage />

                  </ProtectedRoute>

                }

              />

            </Route>



            <Route path="*" element={<Navigate to="/" replace />} />

          </Routes>

        </CartProvider>

      </AuthProvider>

    </BrowserRouter>

  );

}

