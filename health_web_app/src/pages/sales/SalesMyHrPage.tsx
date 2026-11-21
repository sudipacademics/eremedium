import { useEffect, useRef } from 'react';
import { useAuth } from '../../auth/AuthContext';

const PEOPLE = 'https://people.e-remedium.in';

/** People HRMS self-service (profile, attendance, leave, payslips…) — same pattern as Care/Ops. */
export function SalesMyHrPage() {
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
    <div className="rpu-hr-workspace">
      <iframe
        ref={frame}
        title="My HR Profile"
        src={`${PEOPLE}/people/profile?pa_embed=1`}
        allow="geolocation *"
      />
    </div>
  );
}
