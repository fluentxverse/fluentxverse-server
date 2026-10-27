export type SocialBrand = 'linkedin' | 'facebook' | 'x';
const paths: Record<SocialBrand, string> = {
    linkedin: 'M5.372 24H.398V7.982h4.974V24ZM2.882 5.797a2.884 2.884 0 1 1 .032-5.768 2.884 2.884 0 0 1-.032 5.768ZM24 24h-4.965v-7.797c0-1.858-.038-4.249-2.589-4.249-2.589 0-2.986 2.025-2.986 4.115V24H8.49V7.982h4.771v2.185h.069c.665-1.26 2.286-2.589 4.705-2.589C23.065 7.578 24 10.888 24 15.192V24Z',
    facebook: 'M15.117 24V13.053h3.674l.55-4.266h-4.224V6.063c0-1.235.343-2.077 2.114-2.077h2.26V.17C19.1.118 17.76 0 16.201 0c-3.255 0-5.484 1.99-5.484 5.64v3.147H7.034v4.266h3.683V24h4.4Z',
    x: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.64 7.584H.47l8.6-9.835L0 1.154h7.594l5.243 6.932 6.064-6.933Zm-1.29 19.49h2.039L6.487 3.24H4.3l13.31 17.403Z',
};
export default function SocialBrandIcon(props: { name: SocialBrand; size?: number }) {
    return <svg width={props.size ?? 20} height={props.size ?? 20} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={paths[props.name]}/></svg>;
}
