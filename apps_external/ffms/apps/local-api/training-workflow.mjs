export function defaultTrainingVideos() {
  return [
    {
      id: 'training-lab-operations',
      title: 'Lab operations and quality standards',
      description: 'Mandatory introduction to Remedium Lab operating procedures, sample handling and quality control.',
      video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      mime: 'video/youtube',
      duration_minutes: 18,
      franchise_models: ['FOFO', 'FOCO'],
      sort_order: 1,
      is_published: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'training-sample-collection',
      title: 'Sample collection and patient care',
      description: 'Learn approved sample collection, labelling, storage and patient communication standards.',
      video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      mime: 'video/youtube',
      duration_minutes: 22,
      franchise_models: ['FOFO', 'FOCO'],
      sort_order: 2,
      is_published: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'training-brand-compliance',
      title: 'Brand, signage and compliance',
      description: 'Understand Remedium branding rules, signage standards and mandatory compliance checkpoints.',
      video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      mime: 'video/youtube',
      duration_minutes: 16,
      franchise_models: ['FOFO', 'FOCO'],
      sort_order: 3,
      is_published: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'training-go-live',
      title: 'Go-live readiness and support',
      description: 'Final checklist before centre launch, escalation paths and ongoing franchise support.',
      video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      mime: 'video/youtube',
      duration_minutes: 14,
      franchise_models: ['FOFO', 'FOCO'],
      sort_order: 4,
      is_published: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ];
}

export function trainingVideoRecord(value, id = value?.id) {
  if (!value || typeof value !== 'object') return null;
  const franchiseModels = Array.isArray(value.franchise_models) ? value.franchise_models.filter((item) => ['FOFO', 'FOCO'].includes(item)) : ['FOFO', 'FOCO'];
  const youtubeEmbedUrl = String(value.youtube_embed_url ?? value.video_url ?? '').trim();
  const videoUrl = String(value.video_url ?? youtubeEmbedUrl).trim();
  const mime = String(value.mime ?? '').trim() || (youtubeEmbedUrl.includes('youtube') || videoUrl.includes('youtube') ? 'video/youtube' : 'video/mp4');
  return {
    id: id ?? '',
    title: String(value.title ?? '').trim(),
    description: String(value.description ?? '').trim(),
    video_url: videoUrl,
    youtube_embed_code: String(value.youtube_embed_code ?? '').trim(),
    youtube_embed_url: String(value.youtube_embed_url ?? (mime === 'video/youtube' ? videoUrl : '')).trim(),
    mime,
    duration_minutes: Number(value.duration_minutes) || 0,
    franchise_models: franchiseModels.length ? franchiseModels : ['FOFO', 'FOCO'],
    sort_order: Number(value.sort_order) || 0,
    is_published: value.is_published !== false,
    created_at: value.created_at ?? '',
    updated_at: value.updated_at ?? '',
  };
}

export function publishedTrainingVideosForModel(videos, franchiseModel) {
  return (Array.isArray(videos) ? videos : [])
    .map((item) => trainingVideoRecord(item))
    .filter((item) => item?.is_published && item.title && item.video_url && item.franchise_models.includes(franchiseModel))
    .sort((first, second) => first.sort_order - second.sort_order || first.title.localeCompare(second.title));
}

export function agreementExecutedForTraining(application) {
  return application?.agreement_workflow?.status === 'executed';
}

export function canUnlockTraining(application) {
  return agreementExecutedForTraining(application) && !application?.training?.unlocked;
}

export function canIssueTrainingCertificate(application, catalogVideos) {
  const training = application?.training;
  if (!training?.unlocked || training?.certificate?.pdf?.url) return false;
  const assigned = publishedTrainingVideosForModel(catalogVideos, application?.franchise_model ?? 'FOCO');
  return allTrainingVideosComplete(training, assigned.map((video) => video.id));
}

export function canRegenerateTrainingCertificate(application) {
  const training = application?.training;
  return Boolean(training?.certificate?.certificate_number && training?.certificate?.pdf?.url);
}

export function ensureTrainingState(application) {
  if (!application.training || typeof application.training !== 'object') {
    application.training = {
      unlocked: false,
      unlocked_at: '',
      unlocked_by: '',
      business_name: '',
      franchise_address: '',
      videos: [],
      completed_at: '',
      certificate: null,
      history: [],
    };
  }
  if (!('business_name' in application.training)) application.training.business_name = '';
  if (!('franchise_address' in application.training)) application.training.franchise_address = '';
  application.training.videos = Array.isArray(application.training.videos) ? application.training.videos : [];
  application.training.history = Array.isArray(application.training.history) ? application.training.history : [];
  if (!('certificate' in application.training)) application.training.certificate = null;
  return application.training;
}

export function initializeTrainingProgress(application, videos) {
  const training = ensureTrainingState(application);
  const assigned = publishedTrainingVideosForModel(videos, application.franchise_model);
  training.videos = assigned.map((video) => {
    const existing = training.videos.find((item) => item.video_id === video.id);
    return existing ?? { video_id: video.id, completed: false, completed_at: '' };
  });
  return training;
}

export function trainingProgressEntry(training, videoId) {
  return ensureTrainingState({ training }).videos.find((item) => item.video_id === videoId) ?? null;
}

export function trainingVideoAccessible(training, videoId, orderedVideoIds) {
  if (!training?.unlocked) return false;
  const index = orderedVideoIds.indexOf(videoId);
  if (index < 0) return false;
  if (index === 0) return true;
  for (let cursor = 0; cursor < index; cursor += 1) {
    const entry = training.videos.find((item) => item.video_id === orderedVideoIds[cursor]);
    if (!entry?.completed) return false;
  }
  return true;
}

export function trainingCompletionStats(training, orderedVideoIds) {
  const total = orderedVideoIds.length;
  const completed = orderedVideoIds.filter((videoId) => training?.videos?.some((item) => item.video_id === videoId && item.completed)).length;
  return { total, completed, percent: total ? Math.round((completed / total) * 100) : 0 };
}

export function allTrainingVideosComplete(training, orderedVideoIds) {
  const stats = trainingCompletionStats(training, orderedVideoIds);
  return stats.total > 0 && stats.completed === stats.total;
}

export function trainingCertificateNumber(application) {
  return `TRN-${String(application.application_number ?? 'RFMS').replace(/[^A-Za-z0-9-]/g, '')}`;
}

export function businessNameForApplication(application) {
  const shopName = String(application?.branding_signage?.vendor?.shop_name ?? '').trim();
  if (shopName) return shopName;
  return `${application.full_name} - Remedium Lab Franchise`;
}

export function franchiseAddressForApplication(application) {
  const allotmentAddress = String(application?.territory_allotment?.franchise_address ?? '').trim();
  if (allotmentAddress) return allotmentAddress;
  return [application.address, application.city, application.district, application.pincode].filter(Boolean).join(', ');
}

export function trainingWorkflowSummary(application, catalogVideos, resolveUploadUrl) {
  const training = application?.training && typeof application.training === 'object' ? application.training : null;
  const assigned = publishedTrainingVideosForModel(catalogVideos, application?.franchise_model ?? 'FOCO');
  const orderedIds = assigned.map((video) => video.id);
  const stats = trainingCompletionStats(training, orderedIds);
  const certificate = training?.certificate && typeof training.certificate === 'object' && training.certificate.pdf?.url ? training.certificate : null;
  return {
    unlocked: Boolean(training?.unlocked),
    unlocked_at: training?.unlocked_at ?? '',
    unlocked_by: training?.unlocked_by ?? '',
    business_name: training?.business_name ?? '',
    franchise_address: training?.franchise_address || franchiseAddressForApplication(application),
    completed_at: training?.completed_at ?? '',
    progress: stats,
    can_unlock: canUnlockTraining(application),
    can_issue_certificate: canIssueTrainingCertificate(application, catalogVideos),
    can_regenerate_certificate: canRegenerateTrainingCertificate(application),
    certificate: certificate ? {
      certificate_number: certificate.certificate_number ?? '',
      business_name: certificate.business_name ?? '',
      franchise_address: certificate.franchise_address ?? '',
      issued_at: certificate.issued_at ?? '',
      verification_url: certificate.verification_url ?? '',
      qr_reference: certificate.qr_reference ?? certificate.certificate_number ?? '',
      pdf: certificate.pdf && typeof certificate.pdf === 'object'
        ? { name: certificate.pdf.name ?? '', url: resolveUploadUrl(certificate.pdf.url), mime: certificate.pdf.mime ?? 'application/pdf' }
        : null,
    } : null,
    videos: assigned.map((video, index) => {
      const entry = training?.videos?.find((item) => item.video_id === video.id) ?? null;
      const accessible = trainingVideoAccessible(training, video.id, orderedIds);
      const lockedReason = !training?.unlocked
        ? 'Training unlocks after the manager confirms final agreement completion.'
        : index > 0 && !training?.videos?.find((item) => item.video_id === orderedIds[index - 1])?.completed
          ? 'Complete the previous training video first.'
          : '';
      return {
        id: video.id,
        title: video.title,
        description: video.description,
        video_url: resolveUploadUrl(video.video_url),
        mime: video.mime,
        duration_minutes: video.duration_minutes,
        sort_order: video.sort_order,
        sequence: index + 1,
        accessible,
        locked_reason: accessible ? '' : lockedReason,
        completed: Boolean(entry?.completed),
        completed_at: entry?.completed_at ?? '',
      };
    }),
  };
}
