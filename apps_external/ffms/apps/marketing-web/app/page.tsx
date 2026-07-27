'use client';

import { CSSProperties, FormEvent, useEffect, useState } from 'react';
import { RFMS_API_BASE, RFMS_PORTAL_ORIGIN } from '@rfms/utils';
import { TerritoryChecker } from './territory-checker';
import { PublicContent } from './public-content';
import { useCompanyProfile } from './company-profile';
import { HeroSlider } from './hero-slider';
import { WhyRemedium } from './why-remedium';
import { SiteFooter } from './site-footer';
import { SiteNav } from './site-nav';
import { LoginPanel } from './login-panel';
import { HomepageModels } from './homepage-models';
import { useMarketingPages } from './marketing-pages';
import './site.css';
import './login.css';
import './home-extra.css';
import './territory-checker.css';
import './public-content.css';
import './company-profile.css';
import './hero-slider.css';

const SUPPORT_STAGES = [
  ['Discovery', 'We understand your opportunity.', 'Discovery discussion'],
  ['Evaluation', 'Complete the application.', 'Application evaluation'],
  ['Setup', 'Prepare people and location.', 'Centre setup planning'],
  ['Training', 'Build operational readiness.', 'Mandatory training'],
  ['Launch', 'Go live with support.', 'Launch and growth support'],
] as const;

const API_BASE = RFMS_API_BASE;

type SubmissionState = { status: 'idle' | 'submitting' | 'success' | 'error'; message: string };

const INITIAL_SUBMISSION: SubmissionState = { status: 'idle', message: '' };

export default function Home() {
  const [login, setLogin] = useState(false);
  const [kind, setKind] = useState<'Officer' | 'Applicant'>('Officer');
  const [step, setStep] = useState(0);
  const [franchiseState, setFranchiseState] = useState<SubmissionState>(INITIAL_SUBMISSION);
  const [appointmentState, setAppointmentState] = useState<SubmissionState>(INITIAL_SUBMISSION);
  const company = useCompanyProfile();
  const marketingPages = useMarketingPages();

  useEffect(() => {
    const cycle = window.setInterval(() => setStep((current) => (current + 1) % SUPPORT_STAGES.length), 3000);
    return () => window.clearInterval(cycle);
  }, []);

  async function submitFranchiseEnquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setFranchiseState({ status: 'submitting', message: '' });
    try {
      const response = await fetch(`${API_BASE}/leads/public`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.get('name'), mobile: form.get('mobile'), email: form.get('email'), franchise_model: form.get('franchise_model'), territory_query: form.get('territory_query'), notes: form.get('notes') }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? 'Unable to submit your enquiry.');
      formElement.reset();
      setFranchiseState({ status: 'success', message: 'Thank you. Your franchise enquiry is now in the lead directory.' });
    } catch (error) {
      setFranchiseState({ status: 'error', message: error instanceof Error ? error.message : 'Unable to submit your enquiry.' });
    }
  }

  async function submitAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setAppointmentState({ status: 'submitting', message: '' });
    try {
      const response = await fetch(`${API_BASE}/appointments/public`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.get('name'), mobile: form.get('mobile'), email: form.get('email'), preferred_date: form.get('preferred_date'), preferred_time: form.get('preferred_time'), topic: form.get('topic'), notes: form.get('notes') }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? 'Unable to book your appointment.');
      formElement.reset();
      setAppointmentState({ status: 'success', message: 'Appointment request received. Our business team will confirm your consultation shortly.' });
    } catch (error) {
      setAppointmentState({ status: 'error', message: error instanceof Error ? error.message : 'Unable to book your appointment.' });
    }
  }

  return (
    <main id="top" className="site">
      <SiteNav onLoginClick={() => setLogin(true)} />

      <HeroSlider companyName={company.company_name} />

      <HomepageModels content={marketingPages?.homepage_models ?? null} />

      <TerritoryChecker />

      <WhyRemedium company={company} />

      <section id="support" className="section support">
        <h2>Our support. Your success.</h2>
        <p className="intro">Follow your franchise journey from enquiry to growth.</p>
        <div className={`steps animated ${step === SUPPORT_STAGES.length - 1 ? 'celebrating' : ''}`} style={{ '--fill': `${step * 20}%` } as CSSProperties}>
          {SUPPORT_STAGES.map(([title, description], index) => (
            <button className={`${index < step ? 'done' : ''} ${index === step ? 'current' : ''} ${index === SUPPORT_STAGES.length - 1 ? 'launch-stage' : ''}`} onClick={() => setStep(index)} key={title} aria-label={`Show ${title} stage`}>
              <b>{index + 1}</b><h3>{title}</h3><p>{description}</p>
              {index === SUPPORT_STAGES.length - 1 && step === SUPPORT_STAGES.length - 1 ? <span className="confetti-burst" aria-hidden="true">{Array.from({ length: 10 }, (_, piece) => <i key={piece} />)}</span> : null}
            </button>
          ))}
        </div>
        <div className="stage-message">Stage {step + 1}: {SUPPORT_STAGES[step][2]}</div>
      </section>

      <PublicContent />

      <section id="apply" className="consult">
        <div className="consult-heading"><h2>Let&apos;s plan your next business move.</h2><p>Send a franchise enquiry or book a business consultation with the {company.company_name} team.</p></div>
        <div className="consult-grid">
          <article className="consult-card">
            <div className="consult-card-heading"><span>01</span><div><h3>Franchisee query</h3><p>Explore a FOFO or FOCO franchise opportunity.</p></div></div>
            <form onSubmit={submitFranchiseEnquiry}>
              <input required name="name" placeholder="Full name" />
              <input required name="mobile" inputMode="tel" placeholder="Phone number" />
              <input required name="email" type="email" placeholder="Email address" />
              <select name="franchise_model" defaultValue="FOFO" aria-label="Franchise model"><option value="FOFO">FOFO</option><option value="FOCO">FOCO</option></select>
              <input required name="territory_query" placeholder="Preferred territory / location" />
              <textarea name="notes" placeholder="Tell us about your business background" />
              <button className="primary" disabled={franchiseState.status === 'submitting'}>{franchiseState.status === 'submitting' ? 'Submitting…' : 'Submit franchise query'}</button>
            </form>
            {franchiseState.status !== 'idle' ? <p className={`form-message ${franchiseState.status}`} role={franchiseState.status === 'error' ? 'alert' : 'status'}>{franchiseState.message}</p> : null}
          </article>

          <article className="consult-card consultation-card">
            <div className="consult-card-heading"><span>02</span><div><h3>Consult business opportunity with us</h3><p>Book a conversation before you make a decision.</p></div></div>
            <address className="office-address"><b>{company.franchise_hub_name}</b><span>{company.office_address}</span>{company.company_phone || company.company_email ? <small>{[company.company_phone, company.company_email].filter(Boolean).join(' · ')}</small> : <small>In-person consultations are available by confirmed appointment, Monday–Saturday.</small>}</address>
            <form onSubmit={submitAppointment}>
              <input required name="name" placeholder="Full name" />
              <input required name="mobile" inputMode="tel" placeholder="Phone number" />
              <input required name="email" type="email" placeholder="Email address" />
              <input required name="preferred_date" type="date" aria-label="Preferred appointment date" />
              <select required name="preferred_time" defaultValue="" aria-label="Preferred appointment time"><option value="" disabled>Preferred time</option><option>10:00 AM – 12:00 PM</option><option>12:00 PM – 2:00 PM</option><option>2:00 PM – 4:00 PM</option><option>4:00 PM – 6:00 PM</option></select>
              <input required name="topic" placeholder="What would you like to discuss?" />
              <textarea name="notes" placeholder="Any additional details for our team" />
              <button className="primary" disabled={appointmentState.status === 'submitting'}>{appointmentState.status === 'submitting' ? 'Booking…' : 'Book an appointment'}</button>
            </form>
            {appointmentState.status !== 'idle' ? <p className={`form-message ${appointmentState.status}`} role={appointmentState.status === 'error' ? 'alert' : 'status'}>{appointmentState.message}</p> : null}
          </article>
        </div>
      </section>
      <SiteFooter company={company} />
      {login ? <LoginPanel profile={company} kind={kind} setKind={setKind} close={() => setLogin(false)} /> : null}
    </main>
  );
}
