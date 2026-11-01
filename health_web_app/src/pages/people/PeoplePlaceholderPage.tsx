import { Link, useParams } from 'react-router-dom';
import './people-hrms-shell.css';

const COPY: Record<
  string,
  { title: string; body: string; links?: Array<{ to: string; label: string; external?: boolean }> }
> = {
  onboarding: {
    title: 'Onboarding',
    body: 'Structured hire-to-desk onboarding will land here. Meanwhile use applicant onboard and hire-from-careers flows.',
    links: [
      { to: '/onboard', label: 'Applicant onboard' },
      { to: '/people/recruitment', label: 'Hiring desk' },
    ],
  },
  training: {
    title: 'Training & Development',
    body: 'Training curricula and learning plans are managed via Performance / Training in the staff dashboard.',
    links: [{ to: '/dashboard/performance', label: 'Open training & appraisal' }],
  },
  career: {
    title: 'Career & Growth',
    body: 'Staff planning and careers marketing drive role design and hiring plans.',
    links: [
      { to: '/planning', label: 'Staff planning' },
      { to: '/people/recruitment', label: 'Hiring desk' },
      { to: '/careers', label: 'Public careers' },
    ],
  },
  performance: {
    title: 'Performance',
    body: 'Appraisals and training scorecards live on the staff performance module.',
    links: [{ to: '/dashboard/performance', label: 'Open performance' }],
  },
  documents: {
    title: 'Documents',
    body: 'Employee document vault is not enabled in this SPA yet. Use ERP Desk Employee attachments for now.',
    links: [{ to: 'https://erp.e-remedium.in', label: 'Open ERP Desk', external: true }],
  },
  policies: {
    title: 'Policies',
    body: 'Policy handbook will be published here. Until then, store HR policies in Desk / file library.',
    links: [{ to: 'https://erp.e-remedium.in', label: 'Open ERP Desk', external: true }],
  },
  assets: {
    title: 'Assets',
    body: 'Asset assignment for employees (laptops, phones) will appear here. Use Asset module in Desk for masters.',
    links: [{ to: 'https://erp.e-remedium.in', label: 'Open ERP Desk', external: true }],
  },
  announcements: {
    title: 'Announcements',
    body: 'Org-wide announcements board is coming soon.',
  },
  calendar: {
    title: 'Calendar',
    body: 'HR calendar for reviews, payroll cut-offs, and events will appear here.',
  },
  reports: {
    title: 'Reports',
    body: 'Downloadable HR reports will be added next. Org KPIs are already on the Dashboard.',
    links: [{ to: '/people', label: 'Back to Dashboard' }],
  },
  analytics: {
    title: 'Analytics',
    body: 'Advanced workforce analytics (trends, attrition models) will build on the Dashboard org monitor.',
    links: [{ to: '/people', label: 'Back to Dashboard' }],
  },
  company: {
    title: 'Company Settings',
    body: 'Company, leave policy, and payroll masters are managed in ERP Desk.',
    links: [{ to: 'https://erp.e-remedium.in', label: 'Open ERP Desk', external: true }],
  },
  roles: {
    title: 'Role & Permissions',
    body: 'User roles (HR Manager, Employee, etc.) are assigned in Desk → User.',
    links: [{ to: 'https://erp.e-remedium.in', label: 'Open ERP Desk', external: true }],
  },
  integrations: {
    title: 'Integrations',
    body: 'MSG91, Google OAuth, and payroll bank feeds are configured at site / operations level.',
    links: [{ to: 'https://erp.e-remedium.in', label: 'Open ERP Desk', external: true }],
  },
};

export function PeoplePlaceholderPage({
  slug,
  title,
  body,
}: {
  slug?: string;
  title?: string;
  body?: string;
}) {
  const params = useParams();
  const key = slug || params.slug || params.setting || '';
  const conf = COPY[key] || {
    title: title || 'Coming soon',
    body: body || 'This HRMS module is scaffolded for the manager shell and will be wired next.',
  };

  return (
    <div className="hrms-placeholder">
      <h1>{conf.title}</h1>
      <p>{conf.body}</p>
      {conf.links?.length ? (
        <div className="btn-row">
          {conf.links.map((link) =>
            link.external ? (
              <a key={link.to} className="hrms-btn" href={link.to} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ) : (
              <Link key={link.to} className="hrms-btn" to={link.to}>
                {link.label}
              </Link>
            ),
          )}
          <Link className="hrms-btn secondary" to="/people">
            Dashboard
          </Link>
        </div>
      ) : (
        <Link className="hrms-btn secondary" to="/people">
          Dashboard
        </Link>
      )}
    </div>
  );
}
