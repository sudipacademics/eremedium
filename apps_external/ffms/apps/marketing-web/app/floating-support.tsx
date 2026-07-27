'use client';

import { useEffect, useState } from 'react';
import { RFMS_API_BASE } from '@rfms/utils';
import './floating-support.css';

const API_BASE = RFMS_API_BASE;

type SupportSettings = {
  whatsapp_number: string;
  ivr_call_number: string;
  technical_support_number: string;
  technical_whatsapp_number: string;
};

const ICON_WHATSAPP = <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path fill="currentColor" d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/></svg>;
const ICON_PHONE = <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1C10.07 21 3 13.93 3 5a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.25 1.01l-2.2 2.2z"/></svg>;

function phoneHref(number: string) {
  const digits = number.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `tel:+91${digits}`;
  return `tel:+${digits}`;
}

export function FloatingSupportButtons() {
  const [settings, setSettings] = useState<SupportSettings>({ whatsapp_number: '', ivr_call_number: '', technical_support_number: '', technical_whatsapp_number: '' });

  useEffect(() => {
    void fetch(`${API_BASE}/content/support-settings`)
      .then(async (response) => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (response.ok && body?.success && body.data) setSettings(body.data);
      })
      .catch(() => undefined);
  }, []);

  const whatsappHref = settings.whatsapp_number ? `https://wa.me/${settings.whatsapp_number.replace(/\D/g, '')}?text=${encodeURIComponent('Hello Remedium Lab, I would like franchise support.')}` : '';
  const callHref = phoneHref(settings.ivr_call_number);

  return <div className="floating-support-buttons" aria-label="Quick business contact">
    {whatsappHref ? <a className="floating-support-button whatsapp" href={whatsappHref} target="_blank" rel="noreferrer" aria-label="Chat on business WhatsApp">{ICON_WHATSAPP}<span>WhatsApp</span></a> : null}
    {callHref ? <a className="floating-support-button call" href={callHref} aria-label="Call Remedium Lab business line">{ICON_PHONE}<span>Call</span></a> : null}
  </div>;
}
