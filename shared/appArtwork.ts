export const appArtwork = {
    home: 'home-v1.webp',
    schedule: 'schedule-v1.webp',
    training: 'training-v1.webp',
    community: 'community-v1.webp',
    growth: 'growth-v1.webp',
    pay: 'pay-v1.webp',
    dispatch: 'dispatch-v1.png',
    notifications: 'notifications-v1.webp',
    inbox: 'inbox-v1.webp',
    profile: 'profile-v1.webp',
    video: 'video-v1.webp',
    reviews: 'reviews-v1.webp',
    support: 'support-v1.webp',
    issue: 'issue-v1.webp',
    business: 'business-v1.webp',
    vocabulary: 'vocabulary-v1.webp',
    music: 'music-v1.webp',
    story: 'story-v1.webp',
    certificate: 'certificate-v1.webp',
    privacy: 'privacy-v1.webp',
    classroom: 'classroom-v1.webp',
    network: 'network-v1.webp',
    headset: 'headset-v1.webp',
} as const;

export type AppArtworkName = keyof typeof appArtwork;
export const appArtworkSrc = (name: AppArtworkName) => `/assets/img/home-icons/${appArtwork[name]}`;
