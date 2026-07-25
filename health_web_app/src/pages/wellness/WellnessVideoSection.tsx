/** Placeholder YouTube embeds per wellness wing — replace IDs with Remedium procedural videos later. */

export type WellnessVideo = { title: string; topic: string; youtubeId: string };

const DEFAULT_VIDEOS: WellnessVideo[] = [
  { title: 'Session overview', topic: 'Intro', youtubeId: 'LXb3EKWsInQ' },
  { title: 'What to expect', topic: 'Guide', youtubeId: 'M7lc1UVf-VE' },
  { title: 'Care tips', topic: 'Tips', youtubeId: 'aqz-KE-bpKQ' },
  { title: 'Recovery basics', topic: 'Aftercare', youtubeId: 'ScMzIvxBSi4' },
];

export const WELLNESS_WING_VIDEOS: Record<string, WellnessVideo[]> = {
  aesthetics: [
    { title: 'Laser hair removal', topic: 'Hair', youtubeId: 'LXb3EKWsInQ' },
    { title: 'Acne scar care', topic: 'Skin', youtubeId: 'M7lc1UVf-VE' },
    { title: 'Skin rejuvenation', topic: 'Skin', youtubeId: 'aqz-KE-bpKQ' },
    { title: 'Hair restoration basics', topic: 'Hair', youtubeId: 'ScMzIvxBSi4' },
    { title: 'Body contouring overview', topic: 'Body', youtubeId: 'hY7m5jjJ9mM' },
    { title: 'Chemical peels explained', topic: 'Skin', youtubeId: 'C0DPdy98e4c' },
  ],
  psychology: [
    { title: 'Counselling basics', topic: 'Therapy', youtubeId: 'LXb3EKWsInQ' },
    { title: 'Managing stress', topic: 'Wellbeing', youtubeId: 'M7lc1UVf-VE' },
    { title: 'Anxiety support', topic: 'Mental health', youtubeId: 'aqz-KE-bpKQ' },
    { title: 'Sleep & mind', topic: 'Habits', youtubeId: 'ScMzIvxBSi4' },
    { title: 'Family counselling intro', topic: 'Relationships', youtubeId: 'hY7m5jjJ9mM' },
    { title: 'Building resilience', topic: 'Growth', youtubeId: 'C0DPdy98e4c' },
  ],
  physiotherapy: [
    { title: 'Physio assessment', topic: 'Rehab', youtubeId: 'LXb3EKWsInQ' },
    { title: 'Back pain relief', topic: 'Spine', youtubeId: 'M7lc1UVf-VE' },
    { title: 'Knee strengthening', topic: 'Joints', youtubeId: 'aqz-KE-bpKQ' },
    { title: 'Posture correction', topic: 'Form', youtubeId: 'ScMzIvxBSi4' },
    { title: 'Sports injury care', topic: 'Athletes', youtubeId: 'hY7m5jjJ9mM' },
    { title: 'Home exercise tips', topic: 'Home', youtubeId: 'C0DPdy98e4c' },
  ],
  chiropractic: [
    { title: 'Spine alignment basics', topic: 'Spine', youtubeId: 'LXb3EKWsInQ' },
    { title: 'Neck pain care', topic: 'Neck', youtubeId: 'M7lc1UVf-VE' },
    { title: 'Posture & desk work', topic: 'Lifestyle', youtubeId: 'aqz-KE-bpKQ' },
    { title: 'Osteopathy overview', topic: 'Body', youtubeId: 'ScMzIvxBSi4' },
    { title: 'Mobility routines', topic: 'Movement', youtubeId: 'hY7m5jjJ9mM' },
    { title: 'Aftercare guidance', topic: 'Aftercare', youtubeId: 'C0DPdy98e4c' },
  ],
  ayurvedic: [
    { title: 'Ayurveda consultation', topic: 'Dosha', youtubeId: 'LXb3EKWsInQ' },
    { title: 'Abhyanga massage', topic: 'Therapies', youtubeId: 'M7lc1UVf-VE' },
    { title: 'Panchakarma intro', topic: 'Detox', youtubeId: 'aqz-KE-bpKQ' },
    { title: 'Herbal wellness tips', topic: 'Herbs', youtubeId: 'ScMzIvxBSi4' },
    { title: 'Dinacharya routines', topic: 'Lifestyle', youtubeId: 'hY7m5jjJ9mM' },
    { title: 'Mind-body balance', topic: 'Holistic', youtubeId: 'C0DPdy98e4c' },
  ],
  yoga: [
    { title: 'Beginner yoga flow', topic: 'Asana', youtubeId: 'LXb3EKWsInQ' },
    { title: 'Breathwork basics', topic: 'Pranayama', youtubeId: 'M7lc1UVf-VE' },
    { title: 'Meditation starter', topic: 'Mindfulness', youtubeId: 'aqz-KE-bpKQ' },
    { title: 'Flexibility focus', topic: 'Mobility', youtubeId: 'ScMzIvxBSi4' },
    { title: 'Stress-release yoga', topic: 'Calm', youtubeId: 'hY7m5jjJ9mM' },
    { title: 'Evening wind-down', topic: 'Rest', youtubeId: 'C0DPdy98e4c' },
  ],
};

export function videosForWing(wingId: string): WellnessVideo[] {
  return WELLNESS_WING_VIDEOS[wingId] || DEFAULT_VIDEOS;
}

type WellnessVideoSectionProps = {
  wingId: string;
  wingTitle?: string;
};

export function WellnessVideoSection({ wingId, wingTitle }: WellnessVideoSectionProps) {
  const videos = videosForWing(wingId);
  const label = wingTitle || 'wellness';

  return (
    <section id="treatment-videos" className="aesthetics-videos wellness-videos">
      <div className="section-head">
        <div>
          <h2 className="section-title">Treatment videos</h2>
          <p className="section-sub">
            Watch short explainers for {label}. Placeholder clips for now — we will replace these with
            Remedium procedural videos.
          </p>
        </div>
      </div>
      <div className="aesthetics-video-grid">
        {videos.map((video) => (
          <article key={`${wingId}-${video.youtubeId}-${video.title}`} className="aesthetics-video-card">
            <div className="aesthetics-video-frame">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}`}
                title={video.title}
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
            <div className="aesthetics-video-meta">
              <strong>{video.title}</strong>
              <span className="muted">{video.topic}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
