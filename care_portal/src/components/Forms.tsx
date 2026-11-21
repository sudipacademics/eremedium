import { useCare } from '../store';
import { PatientForm } from './forms/PatientForm';
import { AppointmentEdit, AppointmentForm } from './forms/AppointmentForms';
import { PlanForm } from './forms/PlanForm';
import { PlanEditForm } from './forms/PlanEditForm';
import { InvoiceForm, InvoiceView, PaymentForm } from './forms/BillingForms';
import { ItemForm, MovesView, StockForm } from './forms/StockForms';
import { AssetForm, AssetLogsView, AssetServiceForm, BranchForm, PractitionerForm, ServiceForm } from './forms/AdminForms';
import { DiagnosticStarterForm, DiagnosticTestForm } from './forms/DiagnosticForms';
import { DoctorForm } from './forms/DoctorForm';
import { PackageForm } from './forms/PackageForm';
import { SessionBillView } from './forms/SessionBill';
import { LabBookingForm, LabBookingView } from './forms/LabForms';

export function Modals() {
  const { modal, closeModal } = useCare();
  if (!modal) return null;
  switch (modal.kind) {
    case 'patient':
      return <PatientForm patient={modal.patient} then={modal.then} onClose={closeModal} />;
    case 'appointment':
      if (modal.type === 'lab') return <LabBookingForm patientId={modal.patientId} onClose={closeModal} />;
      return <AppointmentForm type={modal.type} patientId={modal.patientId} planId={modal.planId} onClose={closeModal} />;
    case 'labBooking':
      return <LabBookingView id={modal.id} onClose={closeModal} />;
    case 'appointmentEdit':
      return <AppointmentEdit appointment={modal.appointment} onClose={closeModal} />;
    case 'plan':
      return <PlanForm patientId={modal.patientId} packageId={modal.packageId} onClose={closeModal} />;
    case 'planEdit':
      return <PlanEditForm planId={modal.planId} onClose={closeModal} />;
    case 'invoice':
      if (modal.type === 'lab') return <LabBookingForm patientId={modal.patientId} onClose={closeModal} />;
      return <InvoiceForm type={modal.type} patientId={modal.patientId} appointment={modal.appointment} onClose={closeModal} />;
    case 'viewInvoice':
      return <InvoiceView id={modal.id} onClose={closeModal} />;
    case 'payment':
      return <PaymentForm invoice={modal.invoice} onClose={closeModal} />;
    case 'item':
      return <ItemForm item={modal.item} onClose={closeModal} />;
    case 'stock':
      return <StockForm item={modal.item} direction={modal.direction} onClose={closeModal} />;
    case 'moves':
      return <MovesView item={modal.item} onClose={closeModal} />;
    case 'asset':
      return <AssetForm asset={modal.asset} onClose={closeModal} />;
    case 'assetService':
      return <AssetServiceForm asset={modal.asset} onClose={closeModal} />;
    case 'assetLogs':
      return <AssetLogsView asset={modal.asset} onClose={closeModal} />;
    case 'branch':
      return <BranchForm branch={modal.branch} onClose={closeModal} />;
    case 'practitioner':
      return <PractitionerForm practitioner={modal.practitioner} onClose={closeModal} />;
    case 'service':
      return <ServiceForm service={modal.service} category={modal.category} onClose={closeModal} />;
    case 'diagnosticTest':
      return <DiagnosticTestForm test={modal.test} onClose={closeModal} />;
    case 'diagnosticStarter':
      return <DiagnosticStarterForm onClose={closeModal} />;
    case 'doctor':
      return <DoctorForm doctor={modal.doctor} onClose={closeModal} />;
    case 'physioPackage':
      return <PackageForm pkg={modal.pkg} onClose={closeModal} />;
    case 'sessionBill':
      return <SessionBillView id={modal.id} onClose={closeModal} />;
    default:
      return null;
  }
}
