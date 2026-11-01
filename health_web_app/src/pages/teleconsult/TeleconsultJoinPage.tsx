import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';

export function TeleconsultJoinPage() {
  const { appointmentId = '' } = useParams();
  const [params] = useSearchParams();
  const token = params.get('t') || params.get('token') || '';
  const { isAuthenticated } = useAuth();
  const [meetingLink, setMeetingLink] = useState('');
  const [meta, setMeta] = useState<{
    patient_name?: string;
    doctor_name?: string;
    appointment_date?: string;
    appointment_time?: string;
  }>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const embedSrc = useMemo(() => {
    if (!meetingLink) return '';
    // Prefer iframe-friendly Jitsi URL
    try {
      const u = new URL(meetingLink);
      if (!u.searchParams.has('config.prejoinConfig.enabled')) {
        u.searchParams.set('config.prejoinConfig.enabled', 'false');
      }
      return u.toString();
    } catch {
      return meetingLink;
    }
  }, [meetingLink]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api
      .joinVideoSession(appointmentId, token || undefined)
      .then((res) => {
        if (cancelled) return;
        setMeetingLink(res.data.meeting_link || '');
        setMeta({
          patient_name: res.data.patient_name,
          doctor_name: res.data.doctor_name,
          appointment_date: res.data.appointment_date,
          appointment_time: res.data.appointment_time,
        });
        setError('');
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to join video session');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appointmentId, token, isAuthenticated]);

  return (
    <div className="tele-join-page">
      <header className="page-intro">
        <p className="muted">Video consultation</p>
        <h1>Join session</h1>
        {(meta.doctor_name || meta.patient_name) && (
          <p>
            {meta.doctor_name ? `With ${meta.doctor_name}` : null}
            {meta.appointment_date
              ? ` · ${meta.appointment_date}${meta.appointment_time ? ` ${meta.appointment_time}` : ''}`
              : null}
          </p>
        )}
      </header>

      {loading ? <p className="muted">Preparing secure video room…</p> : null}
      {error ? (
        <div>
          <p className="error">{error}</p>
          {!isAuthenticated && !token ? (
            <p>
              <Link to="/login">Sign in</Link> or use the invite link from your booking SMS/email.
            </p>
          ) : null}
        </div>
      ) : null}

      {embedSrc ? (
        <div className="tele-join-frame-wrap">
          <iframe
            className="tele-join-frame"
            title="Video consultation"
            src={embedSrc}
            allow="camera; microphone; fullscreen; display-capture; autoplay"
            allowFullScreen
          />
          <p className="muted tele-join-fallback">
            Camera not working?{' '}
            <a href={meetingLink} target="_blank" rel="noreferrer">
              Open in a new tab
            </a>
          </p>
        </div>
      ) : null}
    </div>
  );
}
