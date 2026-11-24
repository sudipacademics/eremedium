import { useEffect, useRef } from 'react';
import { savedSession } from '../../api';
import { useCare } from '../../store';

const PEOPLE = 'https://people.e-remedium.in';

/* People HRMS self-service (profile, attendance, leave, payslips…) embedded and signed in with this session. */
export function MyHrPage() {
  const { me } = useCare();
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== PEOPLE || !e.data || e.data.type !== 'pa-embed-ready') return;
      const session = savedSession();
      const target = frame.current?.contentWindow;
      if (!target || e.source !== target || !session) return;
      target.postMessage(
        { type: 'pa-embed-session', session: { sid: session.sid, user: me.user, fullName: me.full_name, roles: me.roles } },
        PEOPLE,
      );
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [me]);

  return (
    <div className="hr-workspace">
      <iframe
        ref={frame}
        title="My HR Workspace"
        src={`${PEOPLE}/people/profile?pa_embed=1&tab=hr`}
        allow="geolocation *"
      />
    </div>
  );
}
