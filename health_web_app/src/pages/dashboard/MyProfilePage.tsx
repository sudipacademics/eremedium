import { ReactNode, useEffect, useRef } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { isLabTechnician, isPhlebotomist } from '../../auth/roles';
import { PhlebotomistTrainingPage } from './PhlebotomistTrainingPage';
import './lab-tech-v2.css';
import './my-profile-v2.css';
import './collector-v2.css';

export type ProfileTab = 'profile' | 'hr' | 'hrms' | 'training';
export type HrmsSection = 'home' | 'attendance' | 'leave' | 'expenses' | 'payslips' | 'info';

const PEOPLE = 'https://people.e-remedium.in';
const PEOPLE_EMBED = `${PEOPLE}/people/profile?pa_embed=1&tab=hr`;

const TAB_PATH: Record<ProfileTab, string> = {
  profile: '/dashboard/profile',
  hr: '/dashboard/profile',
  hrms: '/dashboard/profile',
  training: '/dashboard/profile/training',
};

const PEOPLE_SECTION: Record<string, HrmsSection> = {
  '/people/attendance': 'attendance',
  '/people/leave': 'leave',
  '/people/expenses': 'expenses',
  '/people/payslips': 'payslips',
  '/people/profile': 'info',
};

function isLabTechProfileUser(roles: string[] | undefined) {
  return isLabTechnician(roles) || isPhlebotomist(roles);
}

function parseProfileTab(value?: string | null): ProfileTab {
  if (value === 'hr' || value === 'hrms' || value === 'training' || value === 'profile') return value;
  return 'profile';
}

export function peoplePathToHrmsSection(pathname: string): HrmsSection {
  if (PEOPLE_SECTION[pathname]) return PEOPLE_SECTION[pathname];
  return 'home';
}

/** Lab/collector chrome still deep-links old tab paths — fold into the shared People embed (training stays local for collectors). */
export function labTechProfilePath(tab: ProfileTab = 'profile', _section?: HrmsSection) {
  return TAB_PATH[tab] || '/dashboard/profile';
}

function PeopleHrEmbed() {
  const { user } = useAuth();
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== PEOPLE || !e.data || e.data.type !== 'pa-embed-ready') return;
      const target = frame.current?.contentWindow;
      if (!target || e.source !== target || !user?.sid) return;
      target.postMessage(
        {
          type: 'pa-embed-session',
          session: {
            sid: user.sid,
            user: user.user,
            fullName: user.fullName || user.full_name || user.user,
            roles: user.roles || [],
          },
        },
        PEOPLE,
      );
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [user]);

  return (
    <div className="mp2-page pa-ws-on">
      <div className="pa-ws">
        <iframe
          ref={frame}
          className="pa-ws-frame"
          title="My HR Workspace"
          src={PEOPLE_EMBED}
          allow="geolocation *"
        />
      </div>
    </div>
  );
}

/** Lab / collector / staff “My Profile” — same People Profile workspace as every other portal. */
export function MyProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const [search] = useSearchParams();
  const tab = parseProfileTab(tabParam || search.get('tab'));

  useEffect(() => {
    if (tabParam && !['profile', 'hr', 'hrms', 'training'].includes(tabParam)) {
      navigate('/dashboard/profile', { replace: true });
    }
  }, [navigate, tabParam]);

  if (tab === 'training' && isPhlebotomist(user?.roles) && search.get('view') !== 'appraisal') {
    return <PhlebotomistTrainingPage />;
  }

  return <PeopleHrEmbed />;
}

export function LabTechToMyProfile({
  tab = 'profile',
  children,
}: {
  tab?: ProfileTab;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!isLabTechProfileUser(user?.roles)) return <>{children}</>;
  if (pathname === '/people/training' || pathname === '/people/performance') {
    return <Navigate to={labTechProfilePath('training')} replace />;
  }
  const section = tab === 'hrms' ? peoplePathToHrmsSection(pathname) : undefined;
  return <Navigate to={labTechProfilePath(tab, section)} replace />;
}
