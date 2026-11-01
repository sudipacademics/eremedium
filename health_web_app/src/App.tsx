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
import { B2bCatalogPage } from './pages/b2b/B2bCatalogPage';
import { B2bOrderPage } from './pages/b2b/B2bOrderPage';
import { HubLabBillPage } from './pages/b2b/HubLabBillPage';
import { B2bStatementsPage } from './pages/b2b/B2bStatementsPage';
import { B2bCentresPage } from './pages/b2b/B2bCentresPage';
import { B2bWalletPage } from './pages/b2b/B2bWalletPage';
import { B2bEarningsPage } from './pages/b2b/B2bEarningsPage';
import { B2bShipmentsPage } from './pages/b2b/B2bShipmentsPage';
import { B2bVectorBillsPage } from './pages/b2b/B2bVectorBillsPage';
import { B2bMaterialRequestsPage } from './pages/b2b/B2bMaterialRequestsPage';
import { B2bConsumablesInventoryPage } from './pages/b2b/B2bConsumablesInventoryPage';
import { InventoryManagementPage } from './pages/dashboard/inventory/InventoryManagementPage';
import { PartnerPricingChartPage } from './pages/dashboard/PartnerPricingChartPage';
import { B2bBillStatusPage } from './pages/b2b/B2bBillStatusPage';
import { B2bDownloadReportPage } from './pages/b2b/B2bDownloadReportPage';
import { B2bHubDashboardPage } from './pages/b2b/B2bHubDashboardPage';
import { PfLayout } from './pages/pf/PfLayout';
import { PfRequestsPage } from './pages/pf/PfRequestsPage';
import { PfUploadPage } from './pages/pf/PfUploadPage';
import { PfRequestDetailPage } from './pages/pf/PfRequestDetailPage';
import { PfInboxPage } from './pages/dashboard/pf/PfInboxPage';
import { PfJobBoardPage } from './pages/dashboard/pf/PfJobBoardPage';
import { PfJobPage } from './pages/dashboard/pf/PfJobPage';
import { PfOpsPage } from './pages/dashboard/pf/PfOpsPage';
import { SalesLayout } from './components/SalesLayout';
import { AgentsLayout } from './components/AgentsLayout';
import { SalesPortalPage } from './pages/sales/SalesPortalPage';
import { SalesLeadsPage } from './pages/sales/SalesLeadsPage';
import { SalesVisitPage } from './pages/sales/SalesVisitPage';
import { SalesOnboardPage } from './pages/sales/SalesOnboardPage';
import { SalesProfilePage } from './pages/sales/SalesProfilePage';
import { SalesFranchiseesPage } from './pages/sales/SalesFranchiseesPage';
import { SalesCatalogPage } from './pages/sales/SalesCatalogPage';
import { SalesCommissionPage } from './pages/sales/SalesCommissionPage';
import { SalesReportsPage } from './pages/sales/SalesReportsPage';
import { SalesTeamMapPage } from './pages/sales/SalesTeamMapPage';
import { SalesB2bCentresPage } from './pages/sales/SalesB2bCentresPage';
import { SalesB2bSalesPage } from './pages/sales/SalesB2bSalesPage';
import { AgentsDashboardPage } from './pages/agents/AgentsDashboardPage';
import { AgentsProfilePage } from './pages/agents/AgentsProfilePage';
import { AgentsTeamPage } from './pages/agents/AgentsTeamPage';
import { AgentsCommissionsPage } from './pages/agents/AgentsCommissionsPage';
import { AgentsLevelsPage } from './pages/agents/AgentsLevelsPage';
import { AgentsFranchiseesPage } from './pages/agents/AgentsFranchiseesPage';
import { AgentsPublicOnboardPage } from './pages/agents/AgentsPublicOnboardPage';

import { PeopleLayout } from './components/PeopleLayout';
import { PeopleHomePage } from './pages/people/PeopleHomePage';
import { PeopleProfilePage } from './pages/people/PeopleProfilePage';
import { PeopleAttendancePage } from './pages/people/PeopleAttendancePage';
import { PeopleLeavePage } from './pages/people/PeopleLeavePage';
import { PeopleExpensesPage } from './pages/people/PeopleExpensesPage';
import { PeoplePayslipsPage } from './pages/people/PeoplePayslipsPage';
import { PeoplePerformancePage } from './pages/people/PeoplePerformancePage';
import { PeopleEmployeesPage } from './pages/people/PeopleEmployeesPage';
import { PeopleDepartmentsPage } from './pages/people/PeopleDepartmentsPage';
import { PeopleOrgPage } from './pages/people/PeopleOrgPage';
import { PeopleDesignationsPage } from './pages/people/PeopleDesignationsPage';
import { PeopleRecruitmentPage } from './pages/people/PeopleRecruitmentPage';
import { PeoplePlaceholderPage } from './pages/people/PeoplePlaceholderPage';
import { PeopleOnboardingPage } from './pages/people/PeopleOnboardingPage';
import { PeopleTrainingPage } from './pages/people/PeopleTrainingPage';
import { PeopleCareerPage } from './pages/people/PeopleCareerPage';
import { PeopleDocumentsPage } from './pages/people/PeopleDocumentsPage';
import { PeopleFranchiseTeamPage } from './pages/people/PeopleFranchiseTeamPage';
import { PeoplePoliciesPage } from './pages/people/PeoplePoliciesPage';
import { PeopleAssetsPage } from './pages/people/PeopleAssetsPage';
import { PeopleAnnouncementsPage } from './pages/people/PeopleAnnouncementsPage';
import { PeopleCalendarPage } from './pages/people/PeopleCalendarPage';
import { PeopleReportsPage } from './pages/people/PeopleReportsPage';
import { PeopleAnalyticsPage } from './pages/people/PeopleAnalyticsPage';
import { PeopleGradesPage } from './pages/people/PeopleGradesPage';
import { PeopleGeofencingPage } from './pages/people/PeopleGeofencingPage';
import { PeopleRolesPage } from './pages/people/PeopleRolesPage';

import { PlanningLayout } from './components/PlanningLayout';
import { PlanningDashboardPage } from './pages/planning/PlanningDashboardPage';
import { PlanningNewPage } from './pages/planning/PlanningNewPage';
import { PlanningDetailPage } from './pages/planning/PlanningDetailPage';

import { CareersLayout } from './components/CareersLayout';
import { AestheticAdminLayout } from './components/AestheticAdminLayout';
import { HostPortalGate } from './components/HostPortalGate';
import { PortalHostBridge } from './components/PortalHostBridge';
import { isDevPortalHost } from './config/portalHosts';
import { PhleboFirstSiteLazy } from './pages/phlebofirst/PhleboFirstSiteLazy';
import { TeleporterSiteLazy } from './pages/teleporter/TeleporterSiteLazy';
import { UberDocSiteLazy } from './pages/uberdoc/UberDocSiteLazy';
import { VaultSiteLazy } from './pages/vault/VaultSiteLazy';
import { CareersLandingPage } from './pages/careers/CareersLandingPage';
import { JobOpeningsPage } from './pages/careers/JobOpeningsPage';
import { JobApplyPage } from './pages/careers/JobApplyPage';
import { AestheticAdminDashboard } from './pages/aesthetic-admin/AestheticAdminDashboard';
import { AestheticAdminModulePage } from './pages/aesthetic-admin/AestheticAdminModulePage';
import { WellnessBookPage } from './pages/wellness/WellnessBookPage';
import { HrLoginPage } from './pages/HrLoginPage';

import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { CircleLandingPage } from './pages/CircleLandingPage';

import { AccountPage } from './pages/AccountPage';

import { UpdateProfilePage } from './pages/UpdateProfilePage';

import { ReferEarnPage } from './pages/ReferEarnPage';

import { AppointmentBookPage } from './pages/AppointmentBookPage';

import { BookingDetailPage } from './pages/BookingDetailPage';

import { BookingsPage } from './pages/BookingsPage';
import { PatientReportsPage } from './pages/PatientReportsPage';

import { BookLabPage } from './pages/BookLabPage';

import { BookPanelPage } from './pages/BookPanelPage';

import { DashboardIndex } from './pages/dashboard/DashboardIndex';

import { FranchiseeDashboard } from './pages/dashboard/FranchiseeDashboard';

import { PhlebotomistDashboard } from './pages/dashboard/PhlebotomistDashboard';

import { PhlebotomistReports } from './pages/dashboard/PhlebotomistReports';

import { LabTechDashboard } from './pages/dashboard/LabTechDashboard';

import { AllBookingsPage } from './pages/dashboard/AllBookingsPage';

import { LabReportsQueuePage } from './pages/dashboard/LabReportsQueuePage';

import { LabReportEditorPage } from './pages/dashboard/LabReportEditorPage';

import { ReportLifecyclePage } from './pages/dashboard/ReportLifecyclePage';
import { PathologistPage } from './pages/dashboard/PathologistPage';

import { LabAccessionPage } from './pages/dashboard/LabAccessionPage';

import { LabBillEntryPage } from './pages/dashboard/LabBillEntryPage';

import { QcDashboardPage } from './pages/dashboard/QcDashboardPage';

import { QmsDashboardPage } from './pages/dashboard/QmsDashboardPage';

import { CriticalAlertsQueuePage } from './pages/dashboard/CriticalAlertsQueuePage';

import { HrSelfServicePage } from './pages/dashboard/HrSelfServicePage';
import { StaffPerformancePage } from './pages/dashboard/StaffPerformancePage';
import { MyProfilePage, LabTechToMyProfile } from './pages/dashboard/MyProfilePage';
import { ReagentDashboardPage } from './pages/dashboard/ReagentDashboardPage';

import { PublicDashboard } from './pages/dashboard/PublicDashboard';

import { StaffDashboard } from './pages/dashboard/StaffDashboard';
import { ProviderPortalPage } from './pages/dashboard/ProviderPortalPage';
import { DoctorPrescriptionPage } from './pages/dashboard/DoctorPrescriptionPage';
import { DoctorConsultPage } from './pages/dashboard/DoctorConsultPage';
import { SmartSyncPage } from './pages/dashboard/SmartSyncPage';
import { ProviderKnowledgePage } from './pages/dashboard/ProviderKnowledgePage';
import { ProviderApplicationsPage } from './pages/dashboard/ProviderApplicationsPage';
import { BankReconciliationPage } from './pages/dashboard/BankReconciliationPage';
import { TeleconsultQueuePage } from './pages/dashboard/TeleconsultQueuePage';
import { CareHubPage, CareEnrollmentPage } from './pages/care/CarePages';
import { ResearchHubPage } from './pages/ResearchHubPage';

import { PrescriptionsPage } from './pages/PrescriptionsPage';

import { HomePage } from './pages/HomePage';

import { CentresPage } from './pages/CentresPage';

import { JourneyPage } from './pages/JourneyPage';

import { LabPage } from './pages/LabPage';
import { LabTestDetailPage } from './pages/LabTestDetailPage';

import { InsuranceLandingPage } from './pages/InsuranceLandingPage';
import { CareOpsPage } from './pages/dashboard/CareOpsPage';
import { TeleconsultJoinPage } from './pages/teleconsult/TeleconsultJoinPage';
import { SessionOpsPage } from './pages/dashboard/SessionOpsPage';

import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { SignupPage } from './pages/SignupPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { OAuthCallbackPage } from './pages/OAuthCallbackPage';

import { PharmacyCartPage } from './pages/PharmacyCartPage';

import { PharmacyCheckoutPage } from './pages/PharmacyCheckoutPage';

import { PharmacyPage } from './pages/PharmacyPage';

import { ServicesPage } from './pages/ServicesPage';
import { LegalDocumentPage } from './pages/legal/LegalDocumentPage';
import { BlogListPage } from './pages/blog/BlogListPage';
import { BlogPostPage } from './pages/blog/BlogPostPage';
import { SiteCmsPageView } from './pages/cms/SiteCmsPageView';
import { PoliciesHubPage } from './pages/cms/PoliciesHubPage';
import { PressPage } from './pages/cms/PressPage';
import { KnowledgeCentrePage } from './pages/cms/KnowledgeCentrePage';
import { FaqPage } from './pages/cms/FaqPage';



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

const AGENCY_ACCESS = [ROLES.AGENCY_AGENT, ROLES.AGENCY_MANAGER, ROLES.ADMIN, ROLES.SYSTEM_MANAGER];

const PLANNING_ACCESS = [
  ROLES.ADMIN,
  ROLES.SYSTEM_MANAGER,
  'HR Manager',
  'HR User',
];

const PROVIDER_ACCESS = [
  'Physician',
  'Healthcare Provider',
  'Doctor',
  ROLES.PATHOLOGIST,
  ROLES.ADMIN,
  ROLES.SYSTEM_MANAGER,
];



export default function App() {

  return (

    <BrowserRouter>

      <AuthProvider>
        <PortalHostBridge />

        <CartProvider>

          <Routes>
            <Route element={<HostPortalGate />}>

            <Route element={<CareersLayout />}>
              <Route path="career" element={<Navigate to="/careers" replace />} />
              <Route path="careers" element={<CareersLandingPage />} />
              <Route path="jobs" element={<JobOpeningsPage />} />
              <Route path="jobs/:jobId/apply" element={<JobApplyPage />} />
            </Route>

            <Route
              path="wellness/:wingId/book/:serviceCode"
              element={
                <ProtectedRoute>
                  <WellnessBookPage />
                </ProtectedRoute>
              }
            />

            <Route path="aesthetic-admin" element={<AestheticAdminLayout />}>
              <Route index element={<AestheticAdminDashboard />} />
              <Route path="bookings" element={<AestheticAdminModulePage />} />
              <Route path="bookings/:bookingId" element={<AestheticAdminModulePage />} />
              <Route path="bookings/*" element={<AestheticAdminModulePage />} />
              <Route path="services" element={<AestheticAdminModulePage />} />
              <Route path="services/*" element={<AestheticAdminModulePage />} />
              <Route path="products" element={<AestheticAdminModulePage />} />
              <Route path="products/*" element={<AestheticAdminModulePage />} />
              <Route path="machines" element={<AestheticAdminModulePage />} />
              <Route path="machines/*" element={<AestheticAdminModulePage />} />
              <Route path="invoices" element={<AestheticAdminModulePage />} />
              <Route path="invoices/*" element={<AestheticAdminModulePage />} />
              <Route path="branches" element={<AestheticAdminModulePage />} />
              <Route path="employees" element={<AestheticAdminModulePage />} />
              <Route path="employees/*" element={<AestheticAdminModulePage />} />
              <Route path="settings" element={<AestheticAdminModulePage />} />
              <Route path="*" element={<AestheticAdminModulePage />} />
            </Route>

            <Route path="hr/login" element={<HrLoginPage />} />

            <Route path="hr" element={<Navigate to="/people/recruitment" replace />} />
            <Route path="hr/*" element={<Navigate to="/people/recruitment" replace />} />
            <Route path="my" element={<Navigate to="/careers" replace />} />
            <Route path="my/*" element={<Navigate to="/careers" replace />} />

            <Route element={<PublicLayout />}>

              <Route element={<PatientPortalGate />}>

                <Route index element={<HomePage />} />

                <Route path="services" element={<ServicesPage />} />

                <Route path="appointments/book" element={<ProtectedRoute><AppointmentBookPage /></ProtectedRoute>} />

                <Route path="diagnostics" element={<LabPage />} />

                <Route path="diagnostics/test/:itemCode" element={<LabTestDetailPage />} />

                <Route path="lab" element={<Navigate to="/diagnostics" replace />} />

                <Route path="centres" element={<CentresPage />} />

                <Route path="centers" element={<Navigate to="/centres" replace />} />

                <Route path="pharmacy" element={<PharmacyPage />} />

                <Route path="pharmacy/cart" element={<PharmacyCartPage />} />

                <Route path="wellness" element={<Navigate to="/" replace />} />
                <Route path="wellness/*" element={<Navigate to="/" replace />} />

                <Route path="yoga-memberships" element={<Navigate to="/" replace />} />

                <Route
                  path="teleconsult/join/:appointmentId"
                  element={<TeleconsultJoinPage />}
                />

                <Route path="insurance" element={<InsuranceLandingPage />} />

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
                  path="reports"
                  element={
                    <ProtectedRoute>
                      <PatientReportsPage />
                    </ProtectedRoute>
                  }
                />

              <Route

                path="prescriptions"

                element={

                  <ProtectedRoute>

                    <PrescriptionsPage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="care"

                element={

                  <ProtectedRoute>

                    <CareHubPage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="care/:enrollmentId"

                element={

                  <ProtectedRoute>

                    <CareEnrollmentPage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="research"

                element={

                  <ProtectedRoute roles={[...PROVIDER_ACCESS, ...STAFF_ACCESS]}>

                    <ResearchHubPage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="account"

                  element={

                    <ProtectedRoute>

                      <LabTechToMyProfile tab="profile">

                        <AccountPage />

                      </LabTechToMyProfile>

                    </ProtectedRoute>

                  }

                />

                <Route

                  path="account/profile"

                  element={

                    <ProtectedRoute>

                      <LabTechToMyProfile tab="profile">

                        <UpdateProfilePage />

                      </LabTechToMyProfile>

                    </ProtectedRoute>

                  }

                />

                <Route

                  path="account/refer"

                  element={

                    <ProtectedRoute>

                      <ReferEarnPage />

                    </ProtectedRoute>

                  }

                />

                <Route path="subscriptions" element={<SubscriptionsPage />} />
                <Route path="circle" element={<CircleLandingPage />} />

              </Route>

              <Route path="login" element={<LoginPage />} />
              <Route path="signup" element={<SignupPage />} />
              <Route path="forgot-password" element={<ForgotPasswordPage />} />
              <Route path="verify-email" element={<VerifyEmailPage />} />
              <Route path="oauth/callback" element={<OAuthCallbackPage />} />

              <Route path="legal/:docId" element={<LegalDocumentPage />} />
              <Route path="about" element={<SiteCmsPageView pageKey="about" />} />
              <Route path="contact" element={<SiteCmsPageView pageKey="contact" />} />
              <Route path="accreditations" element={<SiteCmsPageView pageKey="accreditations" />} />
              <Route path="policies" element={<PoliciesHubPage />} />
              <Route path="press" element={<PressPage />} />
              <Route path="knowledge" element={<KnowledgeCentrePage />} />
              <Route path="faq" element={<FaqPage />} />
              <Route path="blog" element={<BlogListPage />} />
              <Route path="blog/:slug" element={<BlogPostPage />} />
              <Route path="privacy-policy" element={<Navigate to="/legal/privacy-policy" replace />} />
              <Route path="disclaimer" element={<Navigate to="/legal/disclaimer" replace />} />
              <Route path="terms" element={<Navigate to="/legal/terms-and-conditions" replace />} />
              <Route path="terms-and-conditions" element={<Navigate to="/legal/terms-and-conditions" replace />} />
              <Route path="refund-policy" element={<Navigate to="/legal/refund-policy" replace />} />
              <Route path="data-use-policy" element={<Navigate to="/legal/data-use-policy" replace />} />

            </Route>

              <Route path="b2b" element={<B2bLayout />}>
                <Route index element={<Navigate to="/b2b/hub" replace />} />
                <Route path="catalog" element={<B2bCatalogPage />} />
                <Route path="order" element={<B2bOrderPage />} />
                <Route path="lab-bill" element={<HubLabBillPage />} />
                <Route path="bill-status" element={<B2bBillStatusPage />} />
                <Route path="download-report" element={<B2bDownloadReportPage />} />
                <Route path="wallet" element={<B2bWalletPage />} />
                <Route path="earnings" element={<B2bEarningsPage />} />
                <Route path="shipments" element={<B2bShipmentsPage />} />
                <Route path="vector-bills" element={<B2bVectorBillsPage />} />
                <Route path="material-requests" element={<B2bMaterialRequestsPage />} />
                <Route path="consumables" element={<B2bConsumablesInventoryPage />} />
                <Route path="centres" element={<B2bCentresPage />} />
                <Route path="fofo-commission" element={<Navigate to="/b2b/centres" replace />} />
                <Route path="statements" element={<B2bStatementsPage />} />
                <Route path="hub" element={<B2bHubDashboardPage />} />
                <Route path="phlebofirst" element={<PfRequestsPage basePath="/b2b/phlebofirst" />} />
                <Route path="phlebofirst/new" element={<PfUploadPage basePath="/b2b/phlebofirst" />} />
                <Route path="phlebofirst/:name" element={<PfRequestDetailPage basePath="/b2b/phlebofirst" />} />
              </Route>

              <Route path="pf" element={<PfLayout />}>
                <Route index element={<PfRequestsPage basePath="/pf" />} />
                <Route path="new" element={<PfUploadPage basePath="/pf" />} />
                <Route path=":name" element={<PfRequestDetailPage basePath="/pf" />} />
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
                <Route path="profile" element={<SalesProfilePage />} />
                <Route path="leads" element={<SalesLeadsPage />} />
                <Route path="visit" element={<SalesVisitPage />} />
                <Route path="onboard" element={<SalesOnboardPage />} />
                <Route path="franchisees" element={<SalesFranchiseesPage />} />
                <Route path="catalog" element={<SalesCatalogPage />} />
                <Route path="commissions" element={<SalesCommissionPage />} />
                <Route path="reports" element={<SalesReportsPage />} />
                <Route path="b2b-centres" element={<SalesB2bCentresPage />} />
                <Route path="b2b-sales" element={<SalesB2bSalesPage />} />
                <Route path="map" element={<SalesTeamMapPage />} />
              </Route>

              <Route
                path="agents"
                element={<AgentsLayout />}
              >
                <Route index element={<AgentsPublicOnboardPage />} />
                <Route
                  path="app"
                  element={
                    <ProtectedRoute roles={AGENCY_ACCESS}>
                      <AgentsDashboardPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="me"
                  element={
                    <ProtectedRoute roles={AGENCY_ACCESS}>
                      <AgentsProfilePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="franchisees"
                  element={
                    <ProtectedRoute roles={AGENCY_ACCESS}>
                      <AgentsFranchiseesPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="team"
                  element={
                    <ProtectedRoute roles={AGENCY_ACCESS}>
                      <AgentsTeamPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="commissions"
                  element={
                    <ProtectedRoute roles={AGENCY_ACCESS}>
                      <AgentsCommissionsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="levels"
                  element={
                    <ProtectedRoute roles={AGENCY_ACCESS}>
                      <AgentsLevelsPage />
                    </ProtectedRoute>
                  }
                />
              </Route>

              <Route
                path="people"
                element={
                  <ProtectedRoute>
                    <LabTechToMyProfile tab="hrms">
                      <PeopleLayout />
                    </LabTechToMyProfile>
                  </ProtectedRoute>
                }
              >
                <Route index element={<PeopleHomePage />} />
                <Route path="profile" element={<PeopleProfilePage />} />
                <Route path="attendance" element={<PeopleAttendancePage />} />
                <Route path="leave" element={<PeopleLeavePage />} />
                <Route path="expenses" element={<PeopleExpensesPage />} />
                <Route path="payslips" element={<PeoplePayslipsPage />} />
                <Route path="employees" element={<PeopleEmployeesPage />} />
                <Route path="organization" element={<PeopleOrgPage />} />
                <Route path="departments" element={<PeopleDepartmentsPage />} />
                <Route path="designations" element={<PeopleDesignationsPage />} />
                <Route path="grades" element={<PeopleGradesPage />} />
                <Route path="recruitment" element={<PeopleRecruitmentPage />} />
                <Route path="franchise-team" element={<PeopleFranchiseTeamPage />} />
                <Route path="policies" element={<PeoplePoliciesPage />} />
                <Route path="performance" element={<PeoplePerformancePage />} />
                <Route path="onboarding" element={<PeopleOnboardingPage />} />
                <Route path="training" element={<PeopleTrainingPage />} />
                <Route path="career" element={<PeopleCareerPage />} />
                <Route path="documents" element={<PeopleDocumentsPage />} />
                <Route path="assets" element={<PeopleAssetsPage />} />
                <Route path="announcements" element={<PeopleAnnouncementsPage />} />
                <Route path="calendar" element={<PeopleCalendarPage />} />
                <Route path="reports" element={<PeopleReportsPage />} />
                <Route path="analytics" element={<PeopleAnalyticsPage />} />
                <Route path="settings/company" element={<PeoplePlaceholderPage slug="company" />} />
                <Route path="settings/geofencing" element={<PeopleGeofencingPage />} />
                <Route path="settings/roles" element={<PeopleRolesPage />} />
                <Route
                  path="settings/integrations"
                  element={<PeoplePlaceholderPage slug="integrations" />}
                />
              </Route>

              <Route
                path="planning"
                element={
                  <ProtectedRoute roles={PLANNING_ACCESS}>
                    <PlanningLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<PlanningDashboardPage />} />
                <Route path="new" element={<PlanningNewPage />} />
                <Route path=":planId" element={<PlanningDetailPage />} />
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
                path="phlebotomist/jobs"
                element={
                  <ProtectedRoute roles={[ROLES.PHLEBOTOMIST]}>
                    <PfJobBoardPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="phlebotomist/jobs/:job"
                element={
                  <ProtectedRoute roles={[ROLES.PHLEBOTOMIST]}>
                    <PfJobPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="pf-inbox"
                element={
                  <ProtectedRoute roles={[ROLES.LAB_TECH, ROLES.LAB_MANAGER, ROLES.PF_LAB_AUTHORISER, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, 'Administrator']}>
                    <PfInboxPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="pf-ops"
                element={
                  <ProtectedRoute roles={[ROLES.ADMIN, ROLES.SYSTEM_MANAGER, 'Administrator']}>
                    <PfOpsPage />
                  </ProtectedRoute>
                }
              />

              <Route

                path="lab-tech"

                element={

                  <ProtectedRoute roles={[ROLES.LAB_TECH, ROLES.ADMIN, ROLES.SYSTEM_MANAGER]}>

                    <LabTechDashboard />

                  </ProtectedRoute>

                }

              />

              <Route

                path="all-bookings"

                element={

                  <ProtectedRoute roles={[ROLES.LAB_TECH, ROLES.PATHOLOGIST, ROLES.ADMIN, ROLES.SYSTEM_MANAGER]}>

                    <AllBookingsPage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="lab-reports"

                element={

                  <ProtectedRoute roles={[ROLES.LAB_TECH, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, ROLES.PATHOLOGIST]}>

                    <LabReportsQueuePage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="lab-reports/:trfId"

                element={

                  <ProtectedRoute roles={[ROLES.LAB_TECH, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, ROLES.PATHOLOGIST]}>

                    <LabReportEditorPage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="report-lifecycle"

                element={

                  <ProtectedRoute roles={[ROLES.LAB_TECH, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, ROLES.PATHOLOGIST]}>

                    <ReportLifecyclePage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="pathologist"

                element={

                  <ProtectedRoute roles={[ROLES.LAB_TECH, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, ROLES.PATHOLOGIST]}>

                    <PathologistPage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="pathologist/signed"

                element={

                  <ProtectedRoute roles={[ROLES.LAB_TECH, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, ROLES.PATHOLOGIST]}>

                    <PathologistPage signedOnly />

                  </ProtectedRoute>

                }

              />

              <Route

                path="accession"

                element={

                  <ProtectedRoute roles={[ROLES.LAB_TECH, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, ROLES.PATHOLOGIST]}>

                    <LabAccessionPage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="lab-bill-entry"

                element={

                  <ProtectedRoute roles={[ROLES.LAB_TECH, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, ROLES.PATHOLOGIST]}>

                    <LabBillEntryPage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="qc"

                element={

                  <ProtectedRoute roles={[ROLES.LAB_TECH, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, ROLES.PATHOLOGIST]}>

                    <QcDashboardPage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="qms"

                element={

                  <ProtectedRoute roles={[ROLES.LAB_TECH, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, ROLES.PATHOLOGIST]}>

                    <QmsDashboardPage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="critical-alerts"

                element={

                  <ProtectedRoute roles={[ROLES.LAB_TECH, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, ROLES.PATHOLOGIST]}>

                    <CriticalAlertsQueuePage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="hr"

                element={

                  <ProtectedRoute roles={HR_ACCESS}>

                    <LabTechToMyProfile tab="hr">

                      <HrSelfServicePage />

                    </LabTechToMyProfile>

                  </ProtectedRoute>

                }

              />

              <Route

                path="performance"

                element={

                  <ProtectedRoute roles={HR_ACCESS}>

                    <LabTechToMyProfile tab="training">

                      <StaffPerformancePage />

                    </LabTechToMyProfile>

                  </ProtectedRoute>

                }

              />

              <Route

                path="profile"

                element={

                  <ProtectedRoute roles={[ROLES.LAB_TECH, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, ROLES.PHLEBOTOMIST, ROLES.MATERIAL_REQUESTER]}>

                    <MyProfilePage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="profile/:tab"

                element={

                  <ProtectedRoute roles={[ROLES.LAB_TECH, ROLES.ADMIN, ROLES.SYSTEM_MANAGER, ROLES.PHLEBOTOMIST, ROLES.MATERIAL_REQUESTER]}>

                    <MyProfilePage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="staff"

                element={

                  <ProtectedRoute roles={[ROLES.ADMIN, ROLES.SYSTEM_MANAGER, ROLES.PATHOLOGIST]}>

                    <StaffDashboard />

                  </ProtectedRoute>

                }

              />

              <Route

                path="provider"

                element={

                  <ProtectedRoute roles={PROVIDER_ACCESS}>

                    <ProviderPortalPage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="provider/prescription/:appointmentId"

                element={

                  <ProtectedRoute roles={PROVIDER_ACCESS}>

                    <DoctorPrescriptionPage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="provider/consult/:appointmentId"

                element={

                  <ProtectedRoute roles={PROVIDER_ACCESS}>

                    <DoctorConsultPage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="provider/smartsync"

                element={

                  <ProtectedRoute roles={PROVIDER_ACCESS}>

                    <SmartSyncPage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="provider/knowledge"

                element={

                  <ProtectedRoute roles={PROVIDER_ACCESS}>

                    <ProviderKnowledgePage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="provider-applications"

                element={

                  <ProtectedRoute roles={[ROLES.ADMIN, ROLES.SYSTEM_MANAGER]}>

                    <ProviderApplicationsPage />

                  </ProtectedRoute>

                }

              />

              <Route
                path="bank-reconciliation"
                element={
                  <ProtectedRoute roles={[ROLES.ADMIN, ROLES.SYSTEM_MANAGER, 'Accounts Manager', 'Accounts User']}>
                    <BankReconciliationPage />
                  </ProtectedRoute>
                }
              />

              <Route

                path="teleconsults"

                element={

                  <ProtectedRoute roles={[...PROVIDER_ACCESS, ...STAFF_ACCESS]}>

                    <TeleconsultQueuePage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="session-ops"

                element={

                  <ProtectedRoute roles={[...PROVIDER_ACCESS, ...STAFF_ACCESS]}>

                    <SessionOpsPage />

                  </ProtectedRoute>

                }

              />

              <Route

                path="care-ops"

                element={

                  <ProtectedRoute roles={[...PROVIDER_ACCESS, ...STAFF_ACCESS]}>

                    <CareOpsPage />

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

              <Route
                path="inventory"
                element={
                  <ProtectedRoute roles={[...STAFF_ACCESS, ROLES.LAB_MANAGER, ROLES.MATERIAL_REQUESTER]}>
                    <InventoryManagementPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="partner-pricing"
                element={
                  <ProtectedRoute roles={[ROLES.ADMIN, ROLES.SYSTEM_MANAGER, 'Administrator']}>
                    <PartnerPricingChartPage />
                  </ProtectedRoute>
                }
              />

            </Route>

            <Route
              path="phlebofirst/*"
              element={isDevPortalHost() ? <PhleboFirstSiteLazy basePath="/phlebofirst" /> : <Navigate to="/" replace />}
            />

            <Route
              path="teleporter/*"
              element={isDevPortalHost() ? <TeleporterSiteLazy basePath="/teleporter" /> : <Navigate to="/" replace />}
            />

            <Route
              path="uberdoc/*"
              element={isDevPortalHost() ? <UberDocSiteLazy basePath="/uberdoc" /> : <Navigate to="/" replace />}
            />

            <Route
              path="vault/*"
              element={isDevPortalHost() ? <VaultSiteLazy basePath="/vault" /> : <Navigate to="/" replace />}
            />

            <Route path="*" element={<Navigate to="/" replace />} />

            </Route>

          </Routes>

        </CartProvider>

      </AuthProvider>

    </BrowserRouter>

  );

}

